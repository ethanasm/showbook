/**
 * Unit suite for the /songs page's pure filter/sort helpers. The
 * router applies DB-side filters (performerId, year, firstHeardOnly,
 * tourDebutOnly); these helpers handle the UI-side passes that the
 * page re-runs in response to keystrokes without re-querying.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesSearch,
  sortRows,
  DEFAULT_SORT,
  type SongRow,
} from '../songs/filters';

function row(over: Partial<SongRow> = {}): SongRow {
  return {
    songId: 'sng-x',
    performerId: 'perf-x',
    performerName: 'Performer X',
    title: 'Song X',
    timesHeard: 1,
    firstHeard: '2025-01-01',
    lastHeard: '2025-01-01',
    isUserDebut: true,
    ...over,
  };
}

describe('matchesSearch', () => {
  test('returns true for an empty query', () => {
    assert.equal(matchesSearch(row(), ''), true);
  });

  test('matches on song title (case-insensitive)', () => {
    assert.equal(matchesSearch(row({ title: 'Bloodbuzz Ohio' }), 'bloodbuzz'), true);
    assert.equal(matchesSearch(row({ title: 'Bloodbuzz Ohio' }), 'BLOOD'), true);
    assert.equal(matchesSearch(row({ title: 'Bloodbuzz Ohio' }), 'unmatched'), false);
  });

  test('matches on performer name', () => {
    assert.equal(matchesSearch(row({ performerName: 'The National' }), 'national'), true);
  });

  test('does NOT match on dates (firstHeard/lastHeard are out of scope)', () => {
    assert.equal(matchesSearch(row({ firstHeard: '2024-03-22' }), '2024'), false);
  });
});

describe('sortRows', () => {
  const rows = [
    row({ title: 'Bloodbuzz Ohio', performerName: 'The National', timesHeard: 3, lastHeard: '2025-03-30' }),
    row({ title: 'Fake Empire', performerName: 'The National', timesHeard: 1, lastHeard: '2024-06-15' }),
    row({ title: 'All My Friends', performerName: 'LCD Soundsystem', timesHeard: 2, lastHeard: '2024-08-22' }),
  ];

  test('default sort = count DESC, with title ASC as the tiebreaker', () => {
    const sorted = sortRows(rows, DEFAULT_SORT);
    assert.deepEqual(
      sorted.map((r) => r.title),
      ['Bloodbuzz Ohio', 'All My Friends', 'Fake Empire'],
    );
  });

  test('title ASC sorts alphabetically', () => {
    const sorted = sortRows(rows, { field: 'title', dir: 'asc' });
    assert.deepEqual(
      sorted.map((r) => r.title),
      ['All My Friends', 'Bloodbuzz Ohio', 'Fake Empire'],
    );
  });

  test('performer DESC reverses alphabetic ordering on performer name', () => {
    const sorted = sortRows(rows, { field: 'performer', dir: 'desc' });
    assert.deepEqual(
      sorted.map((r) => r.performerName)[0],
      'The National',
    );
  });

  test('last DESC orders by most-recent attended performance', () => {
    const sorted = sortRows(rows, { field: 'last', dir: 'desc' });
    assert.deepEqual(
      sorted.map((r) => r.title),
      ['Bloodbuzz Ohio', 'All My Friends', 'Fake Empire'],
    );
  });

  test('count ASC puts singletons first', () => {
    const sorted = sortRows(rows, { field: 'count', dir: 'asc' });
    assert.deepEqual(
      sorted.map((r) => r.title)[0],
      'Fake Empire',
    );
  });

  test('does not mutate the input array', () => {
    const titles = rows.map((r) => r.title).join('|');
    sortRows(rows, { field: 'title', dir: 'asc' });
    assert.equal(rows.map((r) => r.title).join('|'), titles);
  });
});
