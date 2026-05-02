/**
 * Outbox + replay integration test.
 *
 * Exercises the M6.A reconnect flow end-to-end against the real outbox
 * (`createOutbox`) backed by the in-memory `SQLiteLike` fake from the
 * unit tests. Verifies:
 *   - 3 writes queued while offline replay in FIFO order on reconnect
 *     and leave the outbox empty
 *   - 4xx during replay leaves the row in place with `last_error` set
 *   - 5xx triggers backoff retry inside the same pass
 *   - Concurrent reconnect events single-flight onto one replay pass
 *
 * The fake DB is duplicated from `outbox.test.ts` so the two files stay
 * independent — this test is integration-flavoured (it composes outbox
 * + replay), not a unit test of either module on its own.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createOutbox,
  __resetOutboxIdCounterForTest,
  __setOutboxClockForTest,
  type SQLiteLike,
  type Outbox,
  type PendingWrite,
} from '../../cache/outbox';
import {
  replayOutbox,
  replayOutboxOnce,
  __resetReplayInFlightForTest,
} from '../../network';

interface PendingRow {
  id: string;
  mutation: string;
  payload: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
}

function fakeDb(): { db: SQLiteLike; rows: Map<string, PendingRow> } {
  const rows = new Map<string, PendingRow>();
  const db: SQLiteLike = {
    async execAsync() {
      // No-op: the in-memory store doesn't need migrations applied.
    },
    async runAsync(sql, params = []) {
      if (/^INSERT INTO pending_writes/i.test(sql)) {
        const [id, mutation, payload, created_at] = params as [string, string, string, number];
        rows.set(id, { id, mutation, payload, created_at, attempts: 0, last_error: null });
      } else if (/^DELETE FROM pending_writes WHERE id/i.test(sql)) {
        rows.delete((params as string[])[0]!);
      } else if (/^DELETE FROM pending_writes$/i.test(sql.trim())) {
        rows.clear();
      } else if (/^UPDATE pending_writes/i.test(sql)) {
        const [error, id] = params as [string, string];
        const row = rows.get(id);
        if (row) {
          row.attempts += 1;
          row.last_error = error;
        }
      }
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      if (/PRAGMA user_version/i.test(sql)) {
        return { user_version: 0 } as unknown as T;
      }
      if (/FROM pending_writes WHERE id/i.test(sql)) {
        const r = rows.get((params as string[])[0]!);
        return (r ?? null) as T | null;
      }
      return null;
    },
    async getAllAsync<T>() {
      const all = Array.from(rows.values()).sort(
        (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
      );
      return all as unknown as T[];
    },
  };
  return { db, rows };
}

async function seedThree(outbox: Outbox): Promise<string[]> {
  let now = 1_000;
  __setOutboxClockForTest(() => now);
  const a = await outbox.enqueue({
    id: 'a',
    mutation: 'shows.update',
    payload: { showId: 's-1', notes: 'first' },
  });
  now = 1_001;
  const b = await outbox.enqueue({
    id: 'b',
    mutation: 'shows.update',
    payload: { showId: 's-2', notes: 'second' },
  });
  now = 1_002;
  const c = await outbox.enqueue({
    id: 'c',
    mutation: 'shows.update',
    payload: { showId: 's-3', notes: 'third' },
  });
  return [a.id, b.id, c.id];
}

describe('outbox replay integration', () => {
  beforeEach(() => {
    __resetOutboxIdCounterForTest();
    __setOutboxClockForTest(() => 1_000);
    __resetReplayInFlightForTest();
  });

  it('replays queued writes in FIFO order and empties the outbox', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    await seedThree(outbox);
    assert.equal(rows.size, 3);

    const order: string[] = [];
    const dispatch = async (write: PendingWrite): Promise<void> => {
      order.push(write.id);
    };
    await replayOutbox({ outbox, dispatch });
    assert.deepEqual(order, ['a', 'b', 'c']);
    assert.equal(rows.size, 0);
  });

  it('4xx leaves the row in place with last_error set', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    await outbox.enqueue({
      id: 'fail-1',
      mutation: 'shows.delete',
      payload: { showId: 'x' },
    });

    const err = Object.assign(new Error('Validation failed'), {
      data: { httpStatus: 422 },
    });
    let calls = 0;
    const dispatch = async (): Promise<void> => {
      calls += 1;
      throw err;
    };
    await replayOutbox({ outbox, dispatch });
    assert.equal(calls, 1, '4xx is not retried');
    assert.equal(rows.size, 1, 'row left in place');
    const reloaded = await outbox.get('fail-1');
    assert.equal(reloaded?.lastError, 'Validation failed');
    assert.equal(reloaded?.attempts, 1);
  });

  it('5xx triggers backoff retry in the same pass', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    await outbox.enqueue({
      id: 'flaky-1',
      mutation: 'shows.update',
      payload: { showId: 'x', notes: 'hello' },
    });

    let calls = 0;
    const dispatch = async (): Promise<void> => {
      calls += 1;
      if (calls < 3) {
        throw Object.assign(new Error('upstream 503'), {
          data: { httpStatus: 503 },
        });
      }
      // Third attempt succeeds.
    };
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
    };
    await replayOutbox({
      outbox,
      dispatch,
      sleep,
      backoffMs: [10, 25],
    });
    assert.equal(calls, 3, 'retried twice after the initial failure');
    assert.deepEqual(sleeps, [10, 25]);
    assert.equal(rows.size, 0, 'row dropped on eventual success');
  });

  it('5xx that exhausts the backoff schedule leaves the row with last_error', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    await outbox.enqueue({
      id: 'hopeless-1',
      mutation: 'shows.update',
      payload: { showId: 'x' },
    });
    let calls = 0;
    const dispatch = async (): Promise<void> => {
      calls += 1;
      throw Object.assign(new Error('server down'), { data: { httpStatus: 500 } });
    };
    await replayOutbox({
      outbox,
      dispatch,
      sleep: async () => undefined,
      backoffMs: [1, 1],
    });
    assert.equal(calls, 3, 'three attempts total (1 initial + 2 retries)');
    assert.equal(rows.size, 1);
    const reloaded = await outbox.get('hopeless-1');
    assert.equal(reloaded?.lastError, 'server down');
  });

  it('concurrent reconnect events single-flight onto one replay pass', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    await seedThree(outbox);

    let totalCalls = 0;
    const dispatch = async (write: PendingWrite): Promise<void> => {
      void write;
      totalCalls += 1;
      // Yield so the main thread can attempt to schedule a parallel
      // replay before we drop the row and advance the FIFO cursor.
      await new Promise<void>((r) => setImmediate(r));
    };

    const p1 = replayOutboxOnce({ outbox, dispatch });
    // Two more synchronous calls land before any dispatch resolves —
    // each must return the same in-flight promise.
    const p2 = replayOutboxOnce({ outbox, dispatch });
    const p3 = replayOutboxOnce({ outbox, dispatch });
    assert.equal(p1, p2, 'second concurrent caller receives the same promise');
    assert.equal(p1, p3, 'third concurrent caller receives the same promise');
    await Promise.all([p1, p2, p3]);
    assert.equal(totalCalls, 3, 'three writes processed exactly once');
    assert.equal(rows.size, 0);

    // After the in-flight pass settles, a fresh call kicks off a new one.
    await outbox.enqueue({
      id: 'after',
      mutation: 'shows.delete',
      payload: { showId: 'y' },
    });
    const p4 = replayOutboxOnce({ outbox, dispatch });
    assert.notEqual(p4, p1);
    await p4;
    assert.equal(rows.size, 0);
  });
});
