/**
 * Process-wide cache database singleton.
 *
 * One `expo-sqlite` handle is opened on first request and reused by both
 * the React Query persister (`sqlite-storage.ts`) and the pending-writes
 * outbox (`outbox.ts`). Migrations run once on open. On sign-out the file
 * is closed and deleted via `deleteCacheDatabase()` so a different user
 * never sees the previous user's cached queries or outbox rows.
 *
 * Every consumer goes through `lazyCacheSqliteLike()`, which returns a
 * `SQLiteLike` whose methods open the singleton on first use and re-open
 * after a `deleteCacheDatabase()` call. That lets the outbox and persister
 * survive sign-out → sign-in cycles without retaining a stale handle.
 */

import * as SQLite from 'expo-sqlite';
import { applyMigrations } from './schema';
import { createOutbox, type Outbox } from './outbox';
import type { SQLiteLike } from './sqlite-adapter';

const DB_NAME = 'showbook-cache.db';

let _db: SQLite.SQLiteDatabase | null = null;
let _opening: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Open the cache database (once per process), apply pending migrations,
 * and return the singleton handle. Idempotent — concurrent callers share
 * the same in-flight open promise.
 */
export async function openCacheDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_opening) return _opening;
  _opening = (async () => {
    const handle = await SQLite.openDatabaseAsync(DB_NAME);
    await applyMigrations(handle as unknown as SQLiteLike);
    _db = handle;
    return handle;
  })();
  try {
    return await _opening;
  } finally {
    _opening = null;
  }
}

/** Close the singleton handle if it's open. Safe to call repeatedly. */
export async function closeCacheDatabase(): Promise<void> {
  const handle = _db;
  _db = null;
  _opening = null;
  if (!handle) return;
  try {
    await handle.closeAsync();
  } catch {
    // Best-effort — the file is about to be deleted anyway.
  }
}

/**
 * Drop the cache database from disk. Used by sign-out so the next user
 * (or a re-sign-in by the same user) starts from an empty cache. Resets
 * the in-memory outbox singleton too.
 */
export async function deleteCacheDatabase(): Promise<void> {
  await closeCacheDatabase();
  _outbox = null;
  try {
    await SQLite.deleteDatabaseAsync(DB_NAME);
  } catch {
    // The file may not exist yet (fresh install). That's fine.
  }
}

/**
 * `SQLiteLike` shim that lazily opens the singleton on first call and
 * re-opens after `deleteCacheDatabase()`. Stable identity across deletes
 * is what lets the outbox factory return a long-lived `Outbox` even
 * though the underlying handle changes.
 *
 * The cast to `SQLiteLike` matches the existing pattern in
 * `sqlite-storage.ts` — `expo-sqlite`'s richer `SQLiteBindValue` typing
 * isn't reachable through our pure-Node-testable `SQLiteLike` interface,
 * but every call site only passes JSON-serialisable scalars.
 */
export function lazyCacheSqliteLike(): SQLiteLike {
  return {
    async execAsync(sql) {
      const db = await openCacheDatabase();
      return (db as unknown as SQLiteLike).execAsync(sql);
    },
    async runAsync(sql, params) {
      const db = await openCacheDatabase();
      return (db as unknown as SQLiteLike).runAsync(sql, params);
    },
    async getFirstAsync(sql, params) {
      const db = await openCacheDatabase();
      return (db as unknown as SQLiteLike).getFirstAsync(sql, params);
    },
    async getAllAsync(sql, params) {
      const db = await openCacheDatabase();
      return (db as unknown as SQLiteLike).getAllAsync(sql, params);
    },
  };
}

let _outbox: Outbox | null = null;

/**
 * Shared outbox singleton, backed by the cache database. Migrations run
 * inside `openCacheDatabase()` so we pass `ensureMigrations: false` here.
 */
export function getCacheOutbox(): Outbox {
  if (_outbox) return _outbox;
  _outbox = createOutbox(lazyCacheSqliteLike(), { ensureMigrations: false });
  return _outbox;
}

/** Reset the outbox singleton — used by tests and by `deleteCacheDatabase`. */
export function resetCacheOutboxForTest(): void {
  _outbox = null;
}
