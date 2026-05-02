/**
 * Migration system invariants:
 *   - applies cleanly on a fresh DB
 *   - is idempotent — running twice is a no-op
 *   - existing migration entries (v1 query_cache) are unchanged
 *
 * The fake `SQLiteLike` here records every SQL statement so we can
 * assert that `pending_writes` was created on first run and skipped on
 * the second.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyMigrations, MIGRATIONS, CURRENT_VERSION } from '../../cache/schema';
import type { SQLiteLike } from '../../cache/sqlite-adapter';

interface FakeDb {
  db: SQLiteLike;
  sql: string[];
  state: { user_version: number };
}

function fakeDb(): FakeDb {
  const sql: string[] = [];
  const state = { user_version: 0 };
  const db: SQLiteLike = {
    async execAsync(s) {
      sql.push(s);
      const m = /PRAGMA user_version\s*=\s*(\d+)/i.exec(s);
      if (m) state.user_version = Number(m[1]);
    },
    async runAsync(s) {
      sql.push(s);
    },
    async getFirstAsync<T>(s: string) {
      sql.push(s);
      if (/PRAGMA user_version/i.test(s)) {
        return { user_version: state.user_version } as unknown as T;
      }
      return null;
    },
    async getAllAsync<T>() {
      return [] as T[];
    },
  };
  return { db, sql, state };
}

describe('cache schema migrations', () => {
  it('exposes both v1 (query_cache) and v2 (pending_writes)', () => {
    const versions = MIGRATIONS.map((m) => m.version).sort((a, b) => a - b);
    assert.deepEqual(versions, [1, 2]);
    const v2 = MIGRATIONS.find((m) => m.version === 2);
    assert.ok(v2, 'v2 migration exists');
    assert.match(v2!.statements.join('\n'), /pending_writes/);
    assert.equal(CURRENT_VERSION, 2);
  });

  it('does not mutate the v1 statement (append-only history)', () => {
    const v1 = MIGRATIONS.find((m) => m.version === 1);
    assert.ok(v1);
    assert.match(v1!.statements.join('\n'), /CREATE TABLE IF NOT EXISTS query_cache/);
    // pending_writes must NOT live in v1 — it would change the migration's
    // shipped meaning for any user who already ran it.
    assert.doesNotMatch(v1!.statements.join('\n'), /pending_writes/);
  });

  it('applies cleanly on a fresh DB', async () => {
    const { db, sql, state } = fakeDb();
    const final = await applyMigrations(db);
    assert.equal(final, 2);
    assert.equal(state.user_version, 2);
    assert.ok(sql.some((s) => /CREATE TABLE IF NOT EXISTS query_cache/.test(s)));
    assert.ok(sql.some((s) => /CREATE TABLE IF NOT EXISTS pending_writes/.test(s)));
  });

  it('running migrations a second time is a no-op', async () => {
    const { db, sql, state } = fakeDb();
    await applyMigrations(db);
    const lenAfterFirst = sql.length;
    await applyMigrations(db);
    // The 2nd run reads user_version twice (once via getUserVersion at
    // start, once via the trailing return) — anything else would be a
    // re-applied migration statement.
    const newStatements = sql.slice(lenAfterFirst).filter((s) => !/PRAGMA user_version/i.test(s));
    assert.deepEqual(newStatements, []);
    assert.equal(state.user_version, 2);
  });

  it('catches up a partially-migrated DB (v1 → v2)', async () => {
    const { db, sql, state } = fakeDb();
    // Pretend v1 has already been applied (e.g. existing user upgrading
    // from M2.A's createSqliteStorage path that set up query_cache).
    state.user_version = 1;
    await applyMigrations(db);
    assert.equal(state.user_version, 2);
    // v1's query_cache statement should NOT have been re-run; only v2.
    const queryCacheStatements = sql.filter((s) => /CREATE TABLE IF NOT EXISTS query_cache/.test(s));
    assert.equal(queryCacheStatements.length, 0);
    const pendingStatements = sql.filter((s) => /CREATE TABLE IF NOT EXISTS pending_writes/.test(s));
    assert.equal(pendingStatements.length, 1);
  });
});
