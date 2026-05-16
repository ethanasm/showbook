/**
 * Schema-scan test for the SI-09 disconnect registry. Walks every
 * pgTable exported from `@showbook/db`, finds anything
 * Spotify-shaped (table name starts `user_spotify_`, OR any column
 * name contains `spotify`), and asserts each appears in EXACTLY ONE
 * of the registry arrays. If a future PR adds a Spotify-derived
 * column without categorizing it, this test fails the build at PR
 * time — forcing the explicit "purge on disconnect or keep as
 * catalog?" decision before merge.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@showbook/db';
import {
  CATALOG_KEEP_COLUMNS,
  USER_SCOPED_AUDIT,
  USER_SCOPED_PURGE_COLUMNS,
  USER_SCOPED_PURGE_TABLES,
} from '../spotify-disconnect-registry';

interface TableInfo {
  /** Drizzle table name (snake_case, matches the SQL identifier). */
  name: string;
  /** Each column's SQL name (snake_case). */
  columns: string[];
}

/**
 * Enumerate every pgTable exported from `@showbook/db`. Drizzle
 * tables are detected via `is(value, PgTable)`.
 */
function getAllTables(): TableInfo[] {
  const out: TableInfo[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const name = getTableName(value);
    const colMap = getTableColumns(value);
    // Column property values carry the underlying SQL `.name` —
    // typed loosely here so the scan stays robust to Drizzle
    // internal-shape changes.
    const cols: string[] = Object.values(colMap).map(
      (c) => (c as { name: string }).name,
    );
    out.push({ name, columns: cols });
  }
  return out;
}

function hasSpotifyShapedName(s: string): boolean {
  return /spotify/i.test(s);
}

describe('spotify-disconnect-registry: schema scan', () => {
  it('every Spotify-shaped table is categorized exactly once', () => {
    const tables = getAllTables();
    const unknown: string[] = [];

    for (const t of tables) {
      // Only tables whose NAME itself is Spotify-shaped (e.g.
      // `user_spotify_tokens`, `user_spotify_skipped_artists`) need
      // table-level categorization. Tables like `shows` that just
      // happen to carry a `spotify_*` column are handled in the
      // column-level pass below.
      if (!t.name.startsWith('user_spotify_')) continue;

      const inPurge = USER_SCOPED_PURGE_TABLES.some((p) => p.table === t.name);
      const inAudit = USER_SCOPED_AUDIT.includes(t.name);
      const matches = Number(inPurge) + Number(inAudit);

      if (matches !== 1) {
        unknown.push(
          `Spotify-shaped table "${t.name}" must appear in EXACTLY ONE of ` +
            `USER_SCOPED_PURGE_TABLES or USER_SCOPED_AUDIT — found in ${matches}.`,
        );
      }
    }

    assert.deepEqual(
      unknown,
      [],
      'Uncategorized Spotify-shaped table(s) — see SI-09 registry:\n' +
        unknown.join('\n'),
    );
  });

  it('every Spotify-shaped column is categorized exactly once', () => {
    const tables = getAllTables();
    const unknown: string[] = [];

    for (const t of tables) {
      // Whole tables that are already audit-flagged at the table
      // level cover all their columns (e.g. `user_spotify_tokens`'s
      // `spotify_user_id` doesn't need its own entry).
      if (USER_SCOPED_AUDIT.includes(t.name)) continue;

      for (const col of t.columns) {
        if (!hasSpotifyShapedName(col)) continue;

        const fqcn = `${t.name}.${col}`;
        const inPurge = USER_SCOPED_PURGE_COLUMNS.some(
          (p) => p.table === t.name && p.column === col,
        );
        const inKeep = CATALOG_KEEP_COLUMNS.includes(fqcn);
        const inAudit = USER_SCOPED_AUDIT.includes(fqcn);
        const matches = Number(inPurge) + Number(inKeep) + Number(inAudit);

        if (matches !== 1) {
          unknown.push(
            `Spotify-shaped column "${fqcn}" must appear in EXACTLY ONE of ` +
              `USER_SCOPED_PURGE_COLUMNS / CATALOG_KEEP_COLUMNS / USER_SCOPED_AUDIT ` +
              `— found in ${matches}.`,
          );
        }
      }
    }

    assert.deepEqual(
      unknown,
      [],
      'Uncategorized Spotify-shaped column(s) — see SI-09 registry:\n' +
        unknown.join('\n'),
    );
  });

  it('registry entries reference real tables and columns', () => {
    const tables = getAllTables();
    const byName = new Map(tables.map((t) => [t.name, new Set(t.columns)]));

    const stale: string[] = [];

    for (const entry of USER_SCOPED_PURGE_COLUMNS) {
      const cols = byName.get(entry.table);
      if (!cols) {
        stale.push(`USER_SCOPED_PURGE_COLUMNS references unknown table "${entry.table}".`);
        continue;
      }
      if (!cols.has(entry.column)) {
        stale.push(
          `USER_SCOPED_PURGE_COLUMNS references unknown column "${entry.table}.${entry.column}".`,
        );
      }
      if (!cols.has(entry.filter)) {
        stale.push(
          `USER_SCOPED_PURGE_COLUMNS filter "${entry.table}.${entry.filter}" doesn't exist.`,
        );
      }
    }

    for (const entry of USER_SCOPED_PURGE_TABLES) {
      const cols = byName.get(entry.table);
      if (!cols) {
        stale.push(`USER_SCOPED_PURGE_TABLES references unknown table "${entry.table}".`);
        continue;
      }
      if (!cols.has(entry.filter)) {
        stale.push(
          `USER_SCOPED_PURGE_TABLES filter "${entry.table}.${entry.filter}" doesn't exist.`,
        );
      }
    }

    for (const fqcn of CATALOG_KEEP_COLUMNS) {
      const [table, column] = fqcn.split('.');
      if (!table || !column) {
        stale.push(`CATALOG_KEEP_COLUMNS entry "${fqcn}" must be "table.column".`);
        continue;
      }
      const cols = byName.get(table);
      if (!cols) {
        stale.push(`CATALOG_KEEP_COLUMNS references unknown table "${table}".`);
        continue;
      }
      if (!cols.has(column)) {
        stale.push(`CATALOG_KEEP_COLUMNS references unknown column "${fqcn}".`);
      }
    }

    for (const entry of USER_SCOPED_AUDIT) {
      if (entry.includes('.')) {
        const [table, column] = entry.split('.');
        const cols = byName.get(table!);
        if (!cols) {
          stale.push(`USER_SCOPED_AUDIT references unknown table "${table}".`);
          continue;
        }
        if (!cols.has(column!)) {
          stale.push(`USER_SCOPED_AUDIT references unknown column "${entry}".`);
        }
      } else {
        const cols = byName.get(entry);
        if (!cols) {
          stale.push(`USER_SCOPED_AUDIT references unknown table "${entry}".`);
        }
      }
    }

    assert.deepEqual(
      stale,
      [],
      'Stale registry entries (table/column no longer exists in schema):\n' +
        stale.join('\n'),
    );
  });
});
