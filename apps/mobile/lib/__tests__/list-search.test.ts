/**
 * Tests for the in-list filter helpers used by the Venues / Artists list
 * screens. The screens filter a merged (followed + with-shows) list client
 * side as the user types into the header search bar, so the matching logic
 * has to be case-insensitive, span multiple fields (venue name + city), and
 * leave the list untouched for an empty query.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuery, filterByQuery } from '../list-search';

describe('normalizeQuery', () => {
  it('trims and lowercases', () => {
    assert.equal(normalizeQuery('  Bowery  '), 'bowery');
  });

  it('collapses an all-whitespace query to empty', () => {
    assert.equal(normalizeQuery('   '), '');
  });
});

interface Row {
  name: string;
  city?: string | null;
}

const rows: Row[] = [
  { name: 'Bowery Ballroom', city: 'New York' },
  { name: 'The Fillmore', city: 'San Francisco' },
  { name: 'Red Rocks', city: null },
];

describe('filterByQuery', () => {
  it('returns the original reference for an empty query', () => {
    const out = filterByQuery(rows, '', (r) => [r.name, r.city]);
    assert.equal(out, rows);
  });

  it('returns the original reference for a whitespace-only query', () => {
    const out = filterByQuery(rows, '   ', (r) => [r.name, r.city]);
    assert.equal(out, rows);
  });

  it('matches on name, case-insensitively', () => {
    const out = filterByQuery(rows, 'fillmore', (r) => [r.name, r.city]);
    assert.deepEqual(
      out.map((r) => r.name),
      ['The Fillmore'],
    );
  });

  it('matches on a secondary field (city)', () => {
    const out = filterByQuery(rows, 'new york', (r) => [r.name, r.city]);
    assert.deepEqual(
      out.map((r) => r.name),
      ['Bowery Ballroom'],
    );
  });

  it('tolerates null / undefined fields', () => {
    const out = filterByQuery(rows, 'rocks', (r) => [r.name, r.city]);
    assert.deepEqual(
      out.map((r) => r.name),
      ['Red Rocks'],
    );
  });

  it('returns an empty list when nothing matches', () => {
    const out = filterByQuery(rows, 'zzz', (r) => [r.name, r.city]);
    assert.equal(out.length, 0);
  });
});
