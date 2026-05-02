/**
 * Unit tests for the pure helpers extracted from `app/search.tsx`.
 *
 * These cover the behaviour the search screen depends on:
 *   - empty queries skip the server round-trip
 *   - server results group by entity type while preserving order + counts
 *   - highlight extraction returns the matched substring with surrounding
 *     context
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractHighlight,
  groupResults,
  isEmptyQuery,
  type RawGlobalResults,
} from '../search';

describe('isEmptyQuery', () => {
  it('returns true for null / undefined / empty / whitespace', () => {
    assert.equal(isEmptyQuery(null), true);
    assert.equal(isEmptyQuery(undefined), true);
    assert.equal(isEmptyQuery(''), true);
    assert.equal(isEmptyQuery('   '), true);
    assert.equal(isEmptyQuery('\n\t '), true);
  });

  it('returns false for any non-empty trimmed string', () => {
    assert.equal(isEmptyQuery('a'), false);
    assert.equal(isEmptyQuery(' Bowery '), false);
  });
});

describe('groupResults', () => {
  it('returns empty groups when input is null', () => {
    const grouped = groupResults(null);
    assert.equal(grouped.total, 0);
    assert.equal(grouped.shows.count, 0);
    assert.equal(grouped.artists.count, 0);
    assert.equal(grouped.venues.count, 0);
    assert.deepEqual(grouped.shows.items, []);
    assert.deepEqual(grouped.artists.items, []);
    assert.deepEqual(grouped.venues.items, []);
  });

  it('returns empty groups for a fully empty payload (no server hit needed shape)', () => {
    const grouped = groupResults({ shows: [], performers: [], venues: [] });
    assert.equal(grouped.total, 0);
    assert.equal(grouped.shows.count, 0);
    assert.equal(grouped.artists.count, 0);
    assert.equal(grouped.venues.count, 0);
  });

  it('preserves order and per-group counts across all three entity types', () => {
    const raw: RawGlobalResults = {
      shows: [
        {
          id: 's1',
          title: 'Bleachers at the Music Hall',
          date: '2026-01-12',
          kind: 'concert',
          state: 'past',
          venueName: 'Music Hall',
          venueCity: 'Brooklyn',
        },
        {
          id: 's2',
          title: 'Sleep Token',
          date: '2026-04-04',
          kind: 'concert',
          state: 'ticketed',
          venueName: 'Forest Hills',
          venueCity: 'Queens',
        },
      ],
      performers: [
        { id: 'p1', name: 'Bleachers', imageUrl: null, showCount: 4 },
        { id: 'p2', name: 'Bleak Future', imageUrl: null, showCount: 1 },
        { id: 'p3', name: 'Bloc Party', imageUrl: null, showCount: 2 },
      ],
      venues: [
        { id: 'v1', name: 'Music Hall of Williamsburg', city: 'Brooklyn', showCount: 6 },
      ],
    };
    const grouped = groupResults(raw);

    assert.equal(grouped.shows.count, 2);
    assert.equal(grouped.artists.count, 3);
    assert.equal(grouped.venues.count, 1);
    assert.equal(grouped.total, 6);

    // Order preserved verbatim
    assert.equal(grouped.shows.items[0]?.id, 's1');
    assert.equal(grouped.shows.items[1]?.id, 's2');
    assert.equal(grouped.artists.items[0]?.id, 'p1');
    assert.equal(grouped.artists.items[1]?.id, 'p2');
    assert.equal(grouped.artists.items[2]?.id, 'p3');
    assert.equal(grouped.venues.items[0]?.id, 'v1');

    // Group types are stable
    assert.equal(grouped.shows.type, 'shows');
    assert.equal(grouped.artists.type, 'artists');
    assert.equal(grouped.venues.type, 'venues');
  });
});

describe('extractHighlight', () => {
  it('returns null when there is no match', () => {
    assert.equal(extractHighlight('Bowery Ballroom', 'sphere'), null);
  });

  it('returns null for empty inputs', () => {
    assert.equal(extractHighlight('', 'a'), null);
    assert.equal(extractHighlight('text', ''), null);
    assert.equal(extractHighlight('text', '   '), null);
    assert.equal(extractHighlight(null, 'a'), null);
    assert.equal(extractHighlight('text', null), null);
  });

  it('returns the matched substring exactly as it appears in the text (case-preserving)', () => {
    const result = extractHighlight('Music Hall of Williamsburg', 'music');
    assert.ok(result);
    // The matched fragment preserves source casing, not the query casing.
    assert.equal(result.match, 'Music');
  });

  it('includes context around the match', () => {
    const result = extractHighlight(
      'The Brooklyn Music Hall is a great venue downtown',
      'music',
    );
    assert.ok(result);
    assert.equal(result.match, 'Music');
    // Before-context contains the word right before the match.
    assert.match(result.before, /Brooklyn/);
    // After-context contains the word right after the match.
    assert.match(result.after, /Hall/);
  });

  it('truncates left context with a leading ellipsis when text starts before the window', () => {
    const text =
      'Some long preamble that exceeds the context window before the actual Sphere match appears.';
    const result = extractHighlight(text, 'Sphere', 12);
    assert.ok(result);
    assert.equal(result.match, 'Sphere');
    assert.equal(result.before.startsWith('…'), true);
  });

  it('truncates right context with a trailing ellipsis when text continues past the window', () => {
    const text = 'Sphere then a long tail that runs well beyond the context width chosen.';
    const result = extractHighlight(text, 'Sphere', 12);
    assert.ok(result);
    assert.equal(result.match, 'Sphere');
    assert.equal(result.after.endsWith('…'), true);
  });
});
