/**
 * Pure-function tests for the legacy setlist → per-performer setlists backfill
 * shape conversion. No DB required.
 * Runnable via:
 *   pnpm --filter @showbook/api exec node --import tsx --test src/__tests__/setlists-shape.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

interface ShowPerformerRow {
  performerId: string;
  role: string;
  sortOrder: number;
}

/**
 * Converts a legacy setlist text[] + headlinerId lookup into the new
 * setlists jsonb shape Record<performerId, string[]>.
 * Mirrors the SQL backfill logic from migration 0010.
 */
function legacyToSetlists(
  setlist: string[] | null,
  showPerformers: ShowPerformerRow[],
): Record<string, string[]> | null {
  if (!setlist || setlist.length === 0) return null;

  const headliners = showPerformers
    .filter((sp) => sp.role === 'headliner')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const headliner = headliners[0];
  if (!headliner) return null;

  return { [headliner.performerId]: setlist };
}

test('maps legacy setlist to headliner performer ID', () => {
  const result = legacyToSetlists(
    ['Song A', 'Song B'],
    [{ performerId: 'perf-1', role: 'headliner', sortOrder: 0 }],
  );
  assert.deepEqual(result, { 'perf-1': ['Song A', 'Song B'] });
});

test('picks lowest sortOrder headliner when multiple exist', () => {
  const result = legacyToSetlists(
    ['Track 1'],
    [
      { performerId: 'co-headliner-b', role: 'headliner', sortOrder: 1 },
      { performerId: 'main-headliner', role: 'headliner', sortOrder: 0 },
    ],
  );
  assert.deepEqual(result, { 'main-headliner': ['Track 1'] });
});

test('returns null when no headliner performer', () => {
  const result = legacyToSetlists(
    ['Song A'],
    [{ performerId: 'support-1', role: 'support', sortOrder: 1 }],
  );
  assert.equal(result, null);
});

test('returns null for empty setlist', () => {
  const result = legacyToSetlists(
    [],
    [{ performerId: 'perf-1', role: 'headliner', sortOrder: 0 }],
  );
  assert.equal(result, null);
});

test('returns null for null setlist', () => {
  const result = legacyToSetlists(
    null,
    [{ performerId: 'perf-1', role: 'headliner', sortOrder: 0 }],
  );
  assert.equal(result, null);
});

test('preserves all songs in order', () => {
  const songs = ['Karma Police', 'Creep', 'Fake Plastic Trees', 'High and Dry'];
  const result = legacyToSetlists(
    songs,
    [{ performerId: 'radiohead', role: 'headliner', sortOrder: 0 }],
  );
  assert.deepEqual(result?.['radiohead'], songs);
});
