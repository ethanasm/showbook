/**
 * Pending-write outbox.
 *
 * Backs the optimistic mutation flow in `lib/mutations/`: every mutation
 * persists a `pending_writes` row before the network call so the change
 * survives a crash, kill, or offline restart. On success the row is
 * dropped; on failure it sticks around with an incremented attempt
 * counter for the next retry sweep.
 *
 * The schema is owned by `cache/schema.ts` (v2 migration). This module
 * is a thin SQL adapter over the table — pure logic, expo-sqlite is
 * imported only via the lazy default opener so tests can pass their
 * own `SQLiteLike` in.
 */

import { adaptDatabase, type SQLiteLike } from './sqlite-adapter';
import { applyMigrations } from './schema';

/** What kind of mutation this row represents. */
export type PendingMutation =
  | 'shows.create'
  | 'shows.update'
  | 'shows.delete'
  | 'shows.updateState'
  | 'shows.setSetlist';

export interface PendingWrite {
  id: string;
  mutation: PendingMutation;
  /** Arbitrary JSON-serialisable payload — the tRPC input. */
  payload: unknown;
  createdAt: number;
  attempts: number;
  lastError: string | null;
}

interface PendingWriteRow {
  id: string;
  mutation: string;
  payload: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
}

export interface Outbox {
  enqueue(input: { id?: string; mutation: PendingMutation; payload: unknown }): Promise<PendingWrite>;
  list(): Promise<PendingWrite[]>;
  get(id: string): Promise<PendingWrite | null>;
  drop(id: string): Promise<void>;
  /** Mark a row as failed. Increments attempts and records the error. */
  recordFailure(id: string, error: string): Promise<void>;
  /** Useful for tests + a future "Clear pending writes" action. */
  clear(): Promise<void>;
}

let _idCounter = 0;
function genId(): string {
  // Encoded `${ts}-${random}-${counter}` so two writes in the same ms
  // across process restarts can't collide (the counter alone resets to
  // zero on cold start). FIFO ordering is enforced by `created_at` on
  // SELECT, so the random suffix doesn't affect dequeue order.
  _idCounter += 1;
  const random = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');
  return `pw-${Date.now().toString(36)}-${random}-${_idCounter.toString(36)}`;
}

/** Reset the in-process id counter. Tests only. */
export function __resetOutboxIdCounterForTest(): void {
  _idCounter = 0;
}

let _nowFn: () => number = Date.now;
/** Override the clock used for `created_at`. Tests only. */
export function __setOutboxClockForTest(fn: () => number): void {
  _nowFn = fn;
}

function rowToWrite(row: PendingWriteRow): PendingWrite {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = null;
  }
  return {
    id: row.id,
    mutation: row.mutation as PendingMutation,
    payload,
    createdAt: row.created_at,
    attempts: row.attempts,
    lastError: row.last_error,
  };
}

/**
 * Wrap a `SQLiteLike` handle in the outbox API. Caller is responsible
 * for ensuring `applyMigrations` has been run; pass `ensureMigrations`
 * to have it done lazily on first call.
 */
export function createOutbox(db: SQLiteLike, opts: { ensureMigrations?: boolean } = {}): Outbox {
  let migrationsReady: Promise<unknown> | null = opts.ensureMigrations
    ? null
    : Promise.resolve();
  async function ready(): Promise<void> {
    if (migrationsReady) {
      await migrationsReady;
      return;
    }
    migrationsReady = applyMigrations(db);
    await migrationsReady;
  }

  return {
    async enqueue({ id, mutation, payload }) {
      await ready();
      const row: PendingWrite = {
        id: id ?? genId(),
        mutation,
        payload,
        createdAt: _nowFn(),
        attempts: 0,
        lastError: null,
      };
      await db.runAsync(
        `INSERT INTO pending_writes (id, mutation, payload, created_at, attempts, last_error)
         VALUES (?, ?, ?, ?, 0, NULL)`,
        [row.id, row.mutation, JSON.stringify(row.payload), row.createdAt],
      );
      return row;
    },
    async list() {
      await ready();
      const rows = await db.getAllAsync<PendingWriteRow>(
        `SELECT id, mutation, payload, created_at, attempts, last_error
         FROM pending_writes
         ORDER BY created_at ASC, id ASC`,
      );
      return rows.map(rowToWrite);
    },
    async get(id) {
      await ready();
      const row = await db.getFirstAsync<PendingWriteRow>(
        `SELECT id, mutation, payload, created_at, attempts, last_error
         FROM pending_writes WHERE id = ?`,
        [id],
      );
      return row ? rowToWrite(row) : null;
    },
    async drop(id) {
      await ready();
      await db.runAsync('DELETE FROM pending_writes WHERE id = ?', [id]);
    },
    async recordFailure(id, error) {
      await ready();
      await db.runAsync(
        `UPDATE pending_writes
         SET attempts = attempts + 1, last_error = ?
         WHERE id = ?`,
        [error.slice(0, 1000), id],
      );
    },
    async clear() {
      await ready();
      await db.runAsync('DELETE FROM pending_writes');
    },
  };
}

// Re-export types/utilities consumed by mutations + tests.
export { adaptDatabase };
export type { SQLiteLike };
