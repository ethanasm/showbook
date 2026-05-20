import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultFestivalLineupSelection,
  sortFestivalLineup,
} from '../setlist-intel/festival-lineup-order';

describe('sortFestivalLineup', () => {
  it('puts the headliner first regardless of input order', () => {
    const sorted = sortFestivalLineup([
      { performerId: 's1', role: 'support', sortOrder: 1 },
      { performerId: 'h', role: 'headliner', sortOrder: 0 },
      { performerId: 's2', role: 'support', sortOrder: 2 },
    ]);
    assert.deepEqual(sorted.map((e) => e.performerId), ['h', 's1', 's2']);
  });

  it('sorts supports by ascending sortOrder after the headliner', () => {
    const sorted = sortFestivalLineup([
      { performerId: 's3', role: 'support', sortOrder: 3 },
      { performerId: 's1', role: 'support', sortOrder: 1 },
      { performerId: 'h', role: 'headliner', sortOrder: 0 },
      { performerId: 's2', role: 'support', sortOrder: 2 },
    ]);
    assert.deepEqual(sorted.map((e) => e.performerId), ['h', 's1', 's2', 's3']);
  });

  it('returns a new array (does not mutate input)', () => {
    const input = [
      { performerId: 's1', role: 'support' as const, sortOrder: 1 },
      { performerId: 'h', role: 'headliner' as const, sortOrder: 0 },
    ];
    const original = [...input];
    sortFestivalLineup(input);
    assert.deepEqual(input, original);
  });

  it('handles an empty lineup', () => {
    assert.deepEqual(sortFestivalLineup([]), []);
  });

  it('preserves entry shape (passes through extra fields)', () => {
    const sorted = sortFestivalLineup([
      { performerId: 's', role: 'support' as const, sortOrder: 1, name: 'Sup' },
      { performerId: 'h', role: 'headliner' as const, sortOrder: 0, name: 'Hed' },
    ]);
    assert.equal(sorted[0].name, 'Hed');
    assert.equal(sorted[1].name, 'Sup');
  });
});

describe('defaultFestivalLineupSelection', () => {
  it('returns the headliner id when one is present', () => {
    const id = defaultFestivalLineupSelection([
      { performerId: 's1', role: 'support', sortOrder: 1 },
      { performerId: 'lorde', role: 'headliner', sortOrder: 0 },
    ]);
    assert.equal(id, 'lorde');
  });

  it('returns the first support by sortOrder when no headliner exists', () => {
    const id = defaultFestivalLineupSelection([
      { performerId: 's3', role: 'support', sortOrder: 3 },
      { performerId: 's1', role: 'support', sortOrder: 1 },
    ]);
    assert.equal(id, 's1');
  });

  it('returns null for an empty lineup', () => {
    assert.equal(defaultFestivalLineupSelection([]), null);
  });
});
