/**
 * Pure adapter that wraps a `SQLiteLike` handle in the `CacheStorage`
 * interface. Split out from `sqlite-storage.ts` so it can be tested
 * (and reused) without importing `expo-sqlite` — the SDK pulls in
 * `react-native`, which doesn't load under `node:test`.
 */

import type { CacheEntry, CacheStorage } from './storage';

/** Subset of `expo-sqlite`'s async API that we use. */
export interface SQLiteLike {
  execAsync(sql: string): Promise<unknown>;
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
  getFirstAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  getAllAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

export const QUERY_CACHE_SCHEMA = `CREATE TABLE IF NOT EXISTS query_cache (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL,
       updated_at INTEGER NOT NULL
     );`;

export function adaptDatabase(db: SQLiteLike): CacheStorage {
  return {
    async get(key) {
      const row = await db.getFirstAsync<{ value: string; updated_at: number }>(
        'SELECT value, updated_at FROM query_cache WHERE key = ?',
        [key],
      );
      if (!row) return null;
      return { value: row.value, updatedAt: row.updated_at };
    },
    async set(key, entry) {
      await db.runAsync(
        `INSERT INTO query_cache (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, entry.value, entry.updatedAt],
      );
    },
    async delete(key) {
      await db.runAsync('DELETE FROM query_cache WHERE key = ?', [key]);
    },
    async clear() {
      await db.runAsync('DELETE FROM query_cache');
    },
    async entries() {
      const rows = await db.getAllAsync<{
        key: string;
        value: string;
        updated_at: number;
      }>('SELECT key, value, updated_at FROM query_cache');
      return rows.map(
        (r) => [r.key, { value: r.value, updatedAt: r.updated_at }] as [string, CacheEntry],
      );
    },
  };
}
