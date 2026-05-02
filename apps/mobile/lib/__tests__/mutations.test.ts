/**
 * runOptimisticMutation contract:
 *   - cache + outbox are written BEFORE the network call
 *   - success → outbox row dropped, reconcile runs
 *   - failure → cache rolled back to snapshot, outbox row retained
 *     with attempts++ and last_error set
 *
 * Tests use the in-memory fake `SQLiteLike` from outbox.test, plus a
 * tiny stub tRPC client so we never reach the wire.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOutbox, type SQLiteLike } from '../cache/outbox';
import { runOptimisticMutation } from '../mutations/index';

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
    async execAsync() {},
    async runAsync(s, params = []) {
      if (/^INSERT INTO pending_writes/i.test(s)) {
        const [id, mutation, payload, created_at] = params as [string, string, string, number];
        rows.set(id, {
          id,
          mutation,
          payload,
          created_at,
          attempts: 0,
          last_error: null,
        });
      } else if (/^DELETE FROM pending_writes WHERE id/i.test(s)) {
        rows.delete((params as string[])[0]);
      } else if (/^UPDATE pending_writes/i.test(s)) {
        const [error, id] = params as [string, string];
        const row = rows.get(id);
        if (row) {
          row.attempts += 1;
          row.last_error = error;
        }
      } else if (/^DELETE FROM pending_writes$/i.test(s.trim())) {
        rows.clear();
      }
    },
    async getFirstAsync<T>(s: string, params: unknown[] = []) {
      if (/PRAGMA user_version/i.test(s)) return { user_version: 0 } as unknown as T;
      if (/FROM pending_writes WHERE id/i.test(s)) {
        const r = rows.get((params as string[])[0]);
        return (r ?? null) as T | null;
      }
      return null;
    },
    async getAllAsync<T>() {
      return Array.from(rows.values()) as unknown as T[];
    },
  };
  return { db, rows };
}

interface TestState {
  notes: string;
}

describe('runOptimisticMutation', () => {
  it('writes to cache + outbox before the network call', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    const cache: TestState = { notes: 'old' };
    const observedOrder: string[] = [];

    await runOptimisticMutation<{ notes: string }, TestState, { ok: true }>({
      mutation: 'shows.update',
      pendingId: 'pw-1',
      input: { notes: 'new' },
      outbox,
      call: async () => {
        observedOrder.push('network');
        // At the moment the call fires, the optimistic patch must
        // already be in the cache and the outbox row must exist.
        assert.equal(cache.notes, 'new');
        assert.equal(rows.size, 1);
        assert.ok(rows.has('pw-1'));
        return { ok: true };
      },
      optimistic: {
        snapshot: () => {
          observedOrder.push('snapshot');
          return { notes: cache.notes };
        },
        apply: (input) => {
          observedOrder.push('apply');
          cache.notes = input.notes;
        },
        rollback: (snap) => {
          cache.notes = snap.notes;
        },
      },
      reconcile: () => {
        observedOrder.push('reconcile');
      },
    });

    assert.deepEqual(observedOrder, ['snapshot', 'apply', 'network', 'reconcile']);
    // Success path: outbox is drained.
    assert.equal(rows.size, 0);
  });

  it('on failure, rolls back the cache and keeps the outbox row with attempts++', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    const cache: TestState = { notes: 'snap' };

    await assert.rejects(
      runOptimisticMutation<{ notes: string }, TestState, never>({
        mutation: 'shows.update',
        pendingId: 'pw-fail',
        input: { notes: 'patched' },
        outbox,
        call: async () => {
          throw new Error('boom');
        },
        optimistic: {
          snapshot: () => ({ notes: cache.notes }),
          apply: (input) => {
            cache.notes = input.notes;
          },
          rollback: (snap) => {
            cache.notes = snap.notes;
          },
        },
      }),
      /boom/,
    );

    // Cache rolled back to snapshot.
    assert.equal(cache.notes, 'snap');
    // Row still in outbox.
    assert.equal(rows.size, 1);
    const row = rows.get('pw-fail');
    assert.equal(row?.attempts, 1);
    assert.equal(row?.last_error, 'boom');
  });

  it('returns the network result and the pending id', async () => {
    const { db } = fakeDb();
    const outbox = createOutbox(db);

    const res = await runOptimisticMutation<{ a: number }, void, { server: string }>({
      mutation: 'shows.create',
      pendingId: 'pw-create',
      input: { a: 1 },
      outbox,
      call: async () => ({ server: 'ok' }),
    });

    assert.deepEqual(res.result, { server: 'ok' });
    assert.equal(res.pendingId, 'pw-create');
  });

  it('skips optimistic apply/rollback when no optimistic block is provided', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);

    await assert.rejects(
      runOptimisticMutation<{ x: number }, never, never>({
        mutation: 'shows.delete',
        pendingId: 'pw-norollback',
        input: { x: 7 },
        outbox,
        call: async () => {
          throw new Error('nope');
        },
      }),
      /nope/,
    );

    // Even with no optimistic block, the outbox still records the failure.
    const row = rows.get('pw-norollback');
    assert.equal(row?.attempts, 1);
  });
});
