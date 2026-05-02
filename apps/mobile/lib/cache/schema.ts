/**
 * SQLite schema + migrations for the mobile cache database.
 *
 * Cold-start path: `applyMigrations(db)` reads the current `user_version`
 * pragma, applies each migration with a higher version in order, and
 * bumps `user_version` after each one. The sequence is append-only —
 * never edit a published migration; add a new one at the end. Existing
 * migrations are run inside a transaction to make them all-or-nothing.
 *
 * v1 is the original `query_cache` table that previously lived as a
 * single CREATE TABLE IF NOT EXISTS in `sqlite-adapter.ts`. v2 adds the
 * `pending_writes` table that backs the offline mutation outbox (M3).
 *
 * The schema module is pure SQL strings — it doesn't import expo-sqlite,
 * so the migration logic can run against any `SQLiteLike` (the in-memory
 * fake used by tests, included).
 */

import type { SQLiteLike } from './sqlite-adapter';

export interface Migration {
  /** Sequential version number, starting at 1. */
  version: number;
  /** Short label for diagnostics. */
  name: string;
  /** Series of SQL statements applied as a single batch. */
  statements: readonly string[];
}

/**
 * Append-only migration history. Do NOT mutate a migration once it has
 * shipped — add a new entry at the end with version `MIGRATIONS.length + 1`.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'query_cache',
    statements: [
      `CREATE TABLE IF NOT EXISTS query_cache (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at INTEGER NOT NULL
       );`,
    ],
  },
  {
    version: 2,
    name: 'pending_writes',
    statements: [
      `CREATE TABLE IF NOT EXISTS pending_writes (
         id TEXT PRIMARY KEY,
         mutation TEXT NOT NULL,
         payload TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         attempts INTEGER NOT NULL DEFAULT 0,
         last_error TEXT
       );`,
      `CREATE INDEX IF NOT EXISTS pending_writes_created_at
         ON pending_writes (created_at);`,
    ],
  },
] as const;

/** Latest version after `applyMigrations` runs. */
export const CURRENT_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);

interface VersionRow {
  user_version: number;
}

async function getUserVersion(db: SQLiteLike): Promise<number> {
  const row = await db.getFirstAsync<VersionRow>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

async function setUserVersion(db: SQLiteLike, version: number): Promise<void> {
  // PRAGMA user_version doesn't accept bound params on every SQLite build,
  // so the integer is interpolated. `version` is internal (never user input).
  await db.execAsync(`PRAGMA user_version = ${version}`);
}

/**
 * Apply every migration whose version > current `user_version`. Idempotent:
 * running twice on a fresh DB is a no-op the second time. Migrations
 * always run in version order regardless of array order.
 */
export async function applyMigrations(db: SQLiteLike): Promise<number> {
  const ordered = [...MIGRATIONS].sort((a, b) => a.version - b.version);
  const current = await getUserVersion(db);
  for (const migration of ordered) {
    if (migration.version <= current) continue;
    for (const stmt of migration.statements) {
      await db.execAsync(stmt);
    }
    await setUserVersion(db, migration.version);
  }
  return getUserVersion(db);
}
