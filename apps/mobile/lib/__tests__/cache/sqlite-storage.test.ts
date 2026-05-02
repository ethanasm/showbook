/**
 * Verifies the expo-sqlite adapter against a hand-rolled in-memory fake
 * that implements `SQLiteLike`. We don't need the native module — the
 * test asserts that the adapter speaks the right SQL and translates
 * column names into `CacheEntry`s.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { adaptDatabase, type SQLiteLike } from '../../cache/sqlite-adapter.js';

interface Row {
  key: string;
  value: string;
  updated_at: number;
}

function fakeDb(): { db: SQLiteLike; sql: string[] } {
  const rows = new Map<string, Row>();
  const sql: string[] = [];
  const db: SQLiteLike = {
    async execAsync(s) {
      sql.push(s);
    },
    async runAsync(s, params = []) {
      sql.push(s);
      if (/^INSERT INTO query_cache/i.test(s)) {
        const [key, value, updated_at] = params as [string, string, number];
        rows.set(key, { key, value, updated_at });
      } else if (/^DELETE FROM query_cache WHERE key/i.test(s)) {
        rows.delete((params as string[])[0]);
      } else if (/^DELETE FROM query_cache$/i.test(s.trim())) {
        rows.clear();
      }
    },
    async getFirstAsync<T>(s: string, params: unknown[] = []) {
      sql.push(s);
      if (/SELECT value, updated_at/i.test(s)) {
        const r = rows.get((params as string[])[0]);
        return r ? ({ value: r.value, updated_at: r.updated_at } as unknown as T) : null;
      }
      return null;
    },
    async getAllAsync<T>(s: string) {
      sql.push(s);
      return Array.from(rows.values()) as unknown as T[];
    },
  };
  return { db, sql };
}

describe('adaptDatabase', () => {
  it('upserts on set then reads back via get', async () => {
    const { db } = fakeDb();
    const storage = adaptDatabase(db);
    await storage.set('k', { value: 'v', updatedAt: 1234 });
    assert.deepEqual(await storage.get('k'), { value: 'v', updatedAt: 1234 });
  });

  it('uses ON CONFLICT upsert SQL', async () => {
    const { db, sql } = fakeDb();
    const storage = adaptDatabase(db);
    await storage.set('k', { value: 'v', updatedAt: 1 });
    assert.ok(sql.some((s) => /ON CONFLICT\(key\) DO UPDATE/i.test(s)));
  });

  it('returns null on missing key', async () => {
    const { db } = fakeDb();
    const storage = adaptDatabase(db);
    assert.equal(await storage.get('nope'), null);
  });

  it('delete removes a row', async () => {
    const { db } = fakeDb();
    const storage = adaptDatabase(db);
    await storage.set('k', { value: 'v', updatedAt: 1 });
    await storage.delete('k');
    assert.equal(await storage.get('k'), null);
  });

  it('clear empties the table', async () => {
    const { db } = fakeDb();
    const storage = adaptDatabase(db);
    await storage.set('a', { value: '1', updatedAt: 1 });
    await storage.set('b', { value: '2', updatedAt: 2 });
    await storage.clear();
    assert.deepEqual(await storage.entries(), []);
  });

  it('entries() maps snake_case columns into CacheEntry', async () => {
    const { db } = fakeDb();
    const storage = adaptDatabase(db);
    await storage.set('a', { value: '1', updatedAt: 11 });
    const all = await storage.entries();
    assert.deepEqual(all, [['a', { value: '1', updatedAt: 11 }]]);
  });
});
