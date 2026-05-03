/**
 * `expo-sqlite`-backed `CacheStorage`. Backed by the shared singleton
 * handle in `db.ts` so the React Query persister and the pending-writes
 * outbox both write into the same file (and are dropped together on
 * sign-out).
 *
 * The schema lives in `schema.ts` — `query_cache` is migration v1,
 * `pending_writes` is v2. `applyMigrations` runs inside
 * `openCacheDatabase()` so this file only adapts an already-migrated
 * handle into the `CacheStorage` interface.
 */

import type { CacheStorage } from './storage';
import { adaptDatabase, type SQLiteLike } from './sqlite-adapter';
import { lazyCacheSqliteLike } from './db';

export interface SqliteStorageOptions {
  /** Pre-opened database handle — tests pass an in-memory fake. */
  database?: SQLiteLike;
}

export async function createSqliteStorage(
  options: SqliteStorageOptions = {},
): Promise<CacheStorage> {
  const db: SQLiteLike = options.database ?? lazyCacheSqliteLike();
  return adaptDatabase(db);
}

export type { SQLiteLike } from './sqlite-adapter';
export { adaptDatabase } from './sqlite-adapter';
