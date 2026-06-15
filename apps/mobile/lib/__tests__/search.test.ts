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
  dedupeDiscoverArtists,
  dedupeDiscoverVenues,
  extractHighlight,
  futureShowToFormParams,
  groupResults,
  isEmptyQuery,
  type DiscoverArtist,
  type DiscoverVenue,
  type FutureShow,
  type RawGlobalResults,
  type SearchPerformer,
  type SearchVenue,
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

describe('dedupeDiscoverArtists', () => {
  const a = (id: string, name: string): DiscoverArtist => ({
    id,
    name,
    imageUrl: null,
    mbid: null,
  });
  const owned = (name: string): SearchPerformer => ({
    id: `owned-${name}`,
    name,
    imageUrl: null,
    showCount: 1,
  });

  it('returns [] for null / undefined input', () => {
    assert.deepEqual(dedupeDiscoverArtists(null, null), []);
    assert.deepEqual(dedupeDiscoverArtists(undefined, undefined), []);
  });

  it('drops artists already present in the owned (logged) results, case/space-insensitively', () => {
    const out = dedupeDiscoverArtists(
      [a('t1', 'Bleachers'), a('t2', '  the   national '), a('t3', 'Phoenix')],
      [owned('bleachers'), owned('The National')],
    );
    assert.deepEqual(
      out.map((x) => x.id),
      ['t3'],
    );
  });

  it('drops intra-list duplicate names, keeping the first (server order)', () => {
    const out = dedupeDiscoverArtists(
      [a('t1', 'Phoenix'), a('t2', 'phoenix'), a('t3', 'Muna')],
      [],
    );
    assert.deepEqual(
      out.map((x) => x.id),
      ['t1', 't3'],
    );
  });

  it('caps at the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => a(`t${i}`, `Act ${i}`));
    assert.equal(dedupeDiscoverArtists(many, [], 6).length, 6);
    assert.equal(dedupeDiscoverArtists(many, [], 2).length, 2);
  });
});

describe('dedupeDiscoverVenues', () => {
  const v = (id: string, name: string): DiscoverVenue => ({ id, name, city: null });
  const owned = (id: string): SearchVenue => ({
    id,
    name: `Owned ${id}`,
    city: null,
    showCount: 1,
  });

  it('returns [] for null / undefined input', () => {
    assert.deepEqual(dedupeDiscoverVenues(null, null), []);
    assert.deepEqual(dedupeDiscoverVenues(undefined, undefined), []);
  });

  it('drops venues whose id is already in the owned results', () => {
    const out = dedupeDiscoverVenues(
      [v('v1', 'A'), v('v2', 'B'), v('v3', 'C')],
      [owned('v2')],
    );
    assert.deepEqual(
      out.map((x) => x.id),
      ['v1', 'v3'],
    );
  });

  it('drops intra-list duplicate ids and caps at the limit', () => {
    const out = dedupeDiscoverVenues(
      [v('v1', 'A'), v('v1', 'A dup'), v('v2', 'B'), v('v3', 'C'), v('v4', 'D')],
      [],
      2,
    );
    assert.deepEqual(
      out.map((x) => x.id),
      ['v1', 'v2'],
    );
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

describe('futureShowToFormParams', () => {
  const base: Omit<FutureShow, 'kind' | 'performers'> = {
    tmEventId: 'evt-1',
    title: 'The Headliner',
    date: '2099-08-15',
    venueName: 'The Greek',
    venueCity: 'Berkeley',
  };

  it('maps a concert: title is the headliner, rest become support', () => {
    const params = futureShowToFormParams({
      ...base,
      kind: 'concert',
      performers: [
        { name: 'The Headliner', tmAttractionId: 'h1', imageUrl: 'img-h' },
        { name: 'Opener One', tmAttractionId: 'o1', imageUrl: null },
        { name: 'Opener Two', tmAttractionId: 'o2', imageUrl: 'img-o2' },
      ],
    });
    assert.equal(params.kindHint, 'concert');
    assert.equal(params.headliner, 'The Headliner');
    assert.equal(params.venueHint, 'The Greek');
    assert.equal(params.venueCity, 'Berkeley');
    assert.equal(params.dateHint, '2099-08-15');

    const lineup = JSON.parse(params.performersJson) as unknown[];
    assert.deepEqual(lineup, [
      { name: 'Opener One', tier: 'support', tmAttractionId: 'o1' },
      { name: 'Opener Two', tier: 'support', tmAttractionId: 'o2', imageUrl: 'img-o2' },
    ]);
  });

  it('maps a festival: every attraction is a lineup row', () => {
    const params = futureShowToFormParams({
      ...base,
      title: 'Sunset Fest',
      kind: 'festival',
      performers: [
        { name: 'Act A', tmAttractionId: 'a', imageUrl: null },
        { name: 'Act B', tmAttractionId: 'b', imageUrl: null },
      ],
    });
    assert.equal(params.kindHint, 'festival');
    assert.equal(params.headliner, 'Sunset Fest');
    const lineup = JSON.parse(params.performersJson) as { name: string }[];
    assert.equal(lineup.length, 2);
    assert.deepEqual(
      lineup.map((r) => r.name),
      ['Act A', 'Act B'],
    );
  });

  it('omits performersJson for theatre (cast comes from a playbill)', () => {
    const params = futureShowToFormParams({
      ...base,
      title: 'Hamilton',
      kind: 'theatre',
      performers: [{ name: 'Hamilton', tmAttractionId: 'h', imageUrl: null }],
    });
    assert.equal(params.kindHint, 'theatre');
    assert.equal(params.headliner, 'Hamilton');
    assert.equal(params.performersJson, undefined);
  });

  it('omits venueCity when the show has no city', () => {
    const params = futureShowToFormParams({
      ...base,
      venueCity: null,
      kind: 'concert',
      performers: [{ name: 'The Headliner', tmAttractionId: 'h1', imageUrl: null }],
    });
    assert.equal(params.venueCity, undefined);
    // Single-attraction concert has no support acts → no lineup param.
    assert.equal(params.performersJson, undefined);
  });
});
