/**
 * Outbox unit tests — pure SQL adapter against an in-memory fake.
 *
 * Verifies:
 *   - enqueue → list / get round trip
 *   - drop removes the row
 *   - FIFO ordering by created_at
 *   - recordFailure increments attempts and stores last_error
 *   - clear nukes everything
 *   - migrations are applied lazily when ensureMigrations is set
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createOutbox,
  __resetOutboxIdCounterForTest,
  __setOutboxClockForTest,
  type SQLiteLike,
} from '../../cache/outbox';

interface PendingRow {
  id: string;
  mutation: string;
  payload: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
}

function fakeDb(): { db: SQLiteLike; rows: Map<string, PendingRow>; sql: string[] } {
  const rows = new Map<string, PendingRow>();
  const sql: string[] = [];
  const db: SQLiteLike = {
    async execAsync(s) {
      sql.push(s);
    },
    async runAsync(s, params = []) {
      sql.push(s);
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
      } else if (/^DELETE FROM pending_writes$/i.test(s.trim())) {
        rows.clear();
      } else if (/^UPDATE pending_writes/i.test(s)) {
        const [error, id] = params as [string, string];
        const row = rows.get(id);
        if (row) {
          row.attempts += 1;
          row.last_error = error;
        }
      }
    },
    async getFirstAsync<T>(s: string, params: unknown[] = []) {
      sql.push(s);
      if (/PRAGMA user_version/i.test(s)) {
        return { user_version: 0 } as unknown as T;
      }
      if (/FROM pending_writes WHERE id/i.test(s)) {
        const r = rows.get((params as string[])[0]);
        return (r ?? null) as T | null;
      }
      return null;
    },
    async getAllAsync<T>(s: string) {
      sql.push(s);
      const all = Array.from(rows.values()).sort(
        (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
      );
      return all as unknown as T[];
    },
  };
  return { db, rows, sql };
}

describe('outbox', () => {
  beforeEach(() => {
    __resetOutboxIdCounterForTest();
    __setOutboxClockForTest(Date.now);
  });

  it('enqueue inserts a row, list reads it back', async () => {
    const { db } = fakeDb();
    const outbox = createOutbox(db);
    const row = await outbox.enqueue({
      mutation: 'shows.update',
      payload: { showId: 'abc', notes: 'hello' },
    });
    assert.equal(row.mutation, 'shows.update');
    assert.equal(row.attempts, 0);
    const list = await outbox.list();
    assert.equal(list.length, 1);
    assert.deepEqual(list[0]!.payload, { showId: 'abc', notes: 'hello' });
  });

  it('honours an explicit id (idempotent retry)', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    await outbox.enqueue({ id: 'fixed-1', mutation: 'shows.delete', payload: { showId: 'x' } });
    assert.equal(rows.size, 1);
    const fetched = await outbox.get('fixed-1');
    assert.equal(fetched?.id, 'fixed-1');
    assert.equal(fetched?.mutation, 'shows.delete');
  });

  it('drop removes the row', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    const row = await outbox.enqueue({
      mutation: 'shows.delete',
      payload: { showId: 'x' },
    });
    await outbox.drop(row.id);
    assert.equal(rows.size, 0);
    assert.equal(await outbox.get(row.id), null);
  });

  it('orders FIFO by created_at', async () => {
    const { db } = fakeDb();
    const outbox = createOutbox(db);
    let now = 1000;
    __setOutboxClockForTest(() => now);
    await outbox.enqueue({ mutation: 'shows.create', payload: { i: 'first' } });
    now = 1001;
    await outbox.enqueue({ mutation: 'shows.create', payload: { i: 'second' } });
    now = 1002;
    await outbox.enqueue({ mutation: 'shows.create', payload: { i: 'third' } });
    const list = await outbox.list();
    assert.deepEqual(
      list.map((r) => (r.payload as { i: string }).i),
      ['first', 'second', 'third'],
    );
  });

  it('recordFailure increments attempts and persists the error', async () => {
    const { db } = fakeDb();
    const outbox = createOutbox(db);
    const row = await outbox.enqueue({
      mutation: 'shows.update',
      payload: { showId: 'a' },
    });
    await outbox.recordFailure(row.id, 'network down');
    await outbox.recordFailure(row.id, 'still down');
    const reloaded = await outbox.get(row.id);
    assert.equal(reloaded?.attempts, 2);
    assert.equal(reloaded?.lastError, 'still down');
  });

  it('clear empties the table', async () => {
    const { db, rows } = fakeDb();
    const outbox = createOutbox(db);
    await outbox.enqueue({ mutation: 'shows.delete', payload: { showId: 'a' } });
    await outbox.enqueue({ mutation: 'shows.delete', payload: { showId: 'b' } });
    assert.equal(rows.size, 2);
    await outbox.clear();
    assert.equal(rows.size, 0);
  });

  it('lazily applies migrations when ensureMigrations is true', async () => {
    const { db, sql } = fakeDb();
    const outbox = createOutbox(db, { ensureMigrations: true });
    // Migrations only run on first use, not at construction time.
    assert.equal(sql.length, 0);
    await outbox.list();
    // PRAGMA user_version → applyMigrations → CREATE TABLE statements.
    assert.ok(sql.some((s) => /PRAGMA user_version/i.test(s)));
    assert.ok(sql.some((s) => /pending_writes/.test(s)));
  });
});
