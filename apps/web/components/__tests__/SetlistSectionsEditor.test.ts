/**
 * Pure-function tests for the row<->section conversion in
 * SetlistSectionsEditor. The DnD UI itself is exercised via Playwright
 * in tests/show-detail.spec.ts; here we only verify that:
 *   - rows produced from a setlist round-trip back to the same setlist
 *   - the divider row's array position determines the encore boundary
 *   - empty sections are dropped on the way out
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setlistToRows,
  rowsToSetlist,
  DIVIDER_ID,
  type Row,
} from '../SetlistSectionsEditor';
import type { PerformerSetlist } from '@showbook/shared';

test('round-trips a main-set-only setlist', () => {
  const setlist: PerformerSetlist = {
    sections: [
      {
        kind: 'set',
        songs: [{ title: 'A' }, { title: 'B' }],
      },
    ],
  };
  const rows = setlistToRows(setlist);
  assert.equal(rows.length, 2);
  assert.equal(rows.every((r) => r.kind === 'song'), true);
  assert.deepEqual(rowsToSetlist(rows), setlist);
});

test('round-trips a setlist with an encore section', () => {
  const setlist: PerformerSetlist = {
    sections: [
      {
        kind: 'set',
        songs: [{ title: 'A' }, { title: 'B', note: 'extended' }],
      },
      {
        kind: 'encore',
        songs: [{ title: 'C' }],
      },
    ],
  };
  const rows = setlistToRows(setlist);
  // 2 main songs + divider + 1 encore song = 4 rows
  assert.equal(rows.length, 4);
  assert.equal(rows[2]!.kind, 'divider');
  assert.deepEqual(rowsToSetlist(rows), setlist);
});

test('rowsToSetlist places everything before the divider in the main set', () => {
  const rows: Row[] = [
    { kind: 'song', id: 'r1', title: 'A' },
    { kind: 'song', id: 'r2', title: 'B' },
    { kind: 'divider', id: DIVIDER_ID },
    { kind: 'song', id: 'r3', title: 'C' },
  ];
  const result = rowsToSetlist(rows);
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0]!.kind, 'set');
  assert.deepEqual(
    result.sections[0]!.songs.map((s) => s.title),
    ['A', 'B'],
  );
  assert.equal(result.sections[1]!.kind, 'encore');
  assert.deepEqual(
    result.sections[1]!.songs.map((s) => s.title),
    ['C'],
  );
});

test('a divider with nothing after it produces no encore section', () => {
  const rows: Row[] = [
    { kind: 'song', id: 'r1', title: 'A' },
    { kind: 'divider', id: DIVIDER_ID },
  ];
  const result = rowsToSetlist(rows);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0]!.kind, 'set');
});

test('an empty rows array produces an empty setlist', () => {
  assert.deepEqual(rowsToSetlist([]), { sections: [] });
});

test('rowsToSetlist preserves notes on songs', () => {
  const rows: Row[] = [
    { kind: 'song', id: 'r1', title: 'A', note: 'extended' },
    { kind: 'song', id: 'r2', title: 'B' },
  ];
  const result = rowsToSetlist(rows);
  assert.equal(result.sections[0]!.songs[0]!.note, 'extended');
  assert.equal(result.sections[0]!.songs[1]!.note, undefined);
});

test('setlistToRows handles encore-only setlists by inserting divider first', () => {
  const setlist: PerformerSetlist = {
    sections: [{ kind: 'encore', songs: [{ title: 'Encore' }] }],
  };
  const rows = setlistToRows(setlist);
  assert.equal(rows[0]!.kind, 'divider');
  assert.equal(rows.length, 2);
});

test('a divider at the front produces an encore-only setlist', () => {
  const rows: Row[] = [
    { kind: 'divider', id: DIVIDER_ID },
    { kind: 'song', id: 'r1', title: 'Encore Only' },
  ];
  const result = rowsToSetlist(rows);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0]!.kind, 'encore');
  assert.deepEqual(
    result.sections[0]!.songs.map((s) => s.title),
    ['Encore Only'],
  );
});
