/**
 * Pure-function tests for the section-shaped per-performer setlist
 * helpers. No DB required.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePerformerSetlist,
  normalizePerformerSetlistsMap,
  singleMainSet,
  flattenSetlistTitles,
  setlistTotalSongs,
  isSetlistEmpty,
} from '@showbook/shared';

test('singleMainSet wraps a flat title array as one main set section', () => {
  const result = singleMainSet(['Just a Girl', 'Hella Good']);
  assert.deepEqual(result, {
    sections: [
      {
        kind: 'set',
        songs: [{ title: 'Just a Girl' }, { title: 'Hella Good' }],
      },
    ],
  });
});

test('flattenSetlistTitles concatenates titles across all sections in order', () => {
  const setlist = {
    sections: [
      {
        kind: 'set' as const,
        songs: [{ title: 'A' }, { title: 'B' }],
      },
      {
        kind: 'encore' as const,
        songs: [{ title: 'C' }],
      },
    ],
  };
  assert.deepEqual(flattenSetlistTitles(setlist), ['A', 'B', 'C']);
});

test('setlistTotalSongs counts across sections', () => {
  const setlist = {
    sections: [
      { kind: 'set' as const, songs: [{ title: 'A' }, { title: 'B' }] },
      { kind: 'encore' as const, songs: [{ title: 'C' }] },
    ],
  };
  assert.equal(setlistTotalSongs(setlist), 3);
});

test('isSetlistEmpty true for null/undefined and for setlists with no songs', () => {
  assert.equal(isSetlistEmpty(null), true);
  assert.equal(isSetlistEmpty(undefined), true);
  assert.equal(isSetlistEmpty({ sections: [] }), true);
  assert.equal(
    isSetlistEmpty({
      sections: [
        { kind: 'set', songs: [] },
        { kind: 'encore', songs: [] },
      ],
    }),
    true,
  );
  assert.equal(
    isSetlistEmpty({
      sections: [{ kind: 'set', songs: [{ title: 'X' }] }],
    }),
    false,
  );
});

// Migration safety: persisted JSONB may still be in the legacy shape during
// a rolling deploy. Reads must tolerate it.

test('normalizePerformerSetlist coerces legacy string[] to a single main set', () => {
  const result = normalizePerformerSetlist(['Song A', 'Song B']);
  assert.deepEqual(result, {
    sections: [
      {
        kind: 'set',
        songs: [{ title: 'Song A' }, { title: 'Song B' }],
      },
    ],
  });
});

test('normalizePerformerSetlist returns null for null/empty/non-object inputs', () => {
  assert.equal(normalizePerformerSetlist(null), null);
  assert.equal(normalizePerformerSetlist(undefined), null);
  assert.equal(normalizePerformerSetlist([]), null);
  assert.equal(normalizePerformerSetlist('not-a-setlist'), null);
  assert.equal(normalizePerformerSetlist({}), null);
});

test('normalizePerformerSetlist preserves valid sections shape', () => {
  const input = {
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
  assert.deepEqual(normalizePerformerSetlist(input), input);
});

test('normalizePerformerSetlist accepts plain string songs and unknown kinds default to set', () => {
  const result = normalizePerformerSetlist({
    sections: [
      { kind: 'weird', songs: ['Plain Title', { title: 'Object Title' }] },
    ],
  });
  assert.deepEqual(result, {
    sections: [
      {
        kind: 'set',
        songs: [{ title: 'Plain Title' }, { title: 'Object Title' }],
      },
    ],
  });
});

test('normalizePerformerSetlistsMap normalizes every value in a map', () => {
  const result = normalizePerformerSetlistsMap({
    'perf-1': ['Old Song'],
    'perf-2': {
      sections: [
        { kind: 'set', songs: [{ title: 'New Song' }] },
      ],
    },
    'perf-3': null,
  });
  assert.deepEqual(result, {
    'perf-1': {
      sections: [
        { kind: 'set', songs: [{ title: 'Old Song' }] },
      ],
    },
    'perf-2': {
      sections: [
        { kind: 'set', songs: [{ title: 'New Song' }] },
      ],
    },
  });
});

test('normalizePerformerSetlistsMap returns {} for null / non-object inputs', () => {
  assert.deepEqual(normalizePerformerSetlistsMap(null), {});
  assert.deepEqual(normalizePerformerSetlistsMap(undefined), {});
  assert.deepEqual(normalizePerformerSetlistsMap('nope'), {});
  assert.deepEqual(normalizePerformerSetlistsMap([]), {});
});
