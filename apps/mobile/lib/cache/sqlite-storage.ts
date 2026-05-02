/**
 * `expo-sqlite`-backed `CacheStorage`. The schema is a single table:
 *
 *   query_cache(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)
 *
 * `value` holds the JSON-serialised React Query result; `updated_at`
 * is epoch milliseconds. Staleness is a render-time decision, not a
 * schema constraint.
 *
 * This file is the only place that imports `expo-sqlite`. The actual
 * SQL adapter lives in `sqlite-adapter.ts` so the pure logic stays
 * testable in Node.
 */

import * as SQLite from 'expo-sqlite';
import type { CacheStorage } from './storage';
import { adaptDatabase, QUERY_CACHE_SCHEMA, type SQLiteLike } from './sqlite-adapter';

const DEFAULT_DB_NAME = 'showbook-cache.db';

export interface SqliteStorageOptions {
  databaseName?: string;
  /** Pre-opened database handle — tests pass an in-memory fake. */
  database?: SQLiteLike;
}

export async function createSqliteStorage(
  options: SqliteStorageOptions = {},
): Promise<CacheStorage> {
  const db: SQLiteLike =
    options.database ??
    ((await SQLite.openDatabaseAsync(
      options.databaseName ?? DEFAULT_DB_NAME,
    )) as unknown as SQLiteLike);
  await db.execAsync(QUERY_CACHE_SCHEMA);
  return adaptDatabase(db);
}

export type { SQLiteLike } from './sqlite-adapter';
export { adaptDatabase } from './sqlite-adapter';
