/**
 * Unit tests for the search.global tRPC procedure. Drives the
 * fan-in/fan-out branches without standing up Postgres: empty
 * showIds short-circuit, no relevant venue ids short-circuit,
 * dateless-show sort-to-top, and the headliner-vs-production-name
 * title selection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { searchRouter } from '../routers/search';
import { makeFakeDb, fakeCtx, type FakeDb } from './_fake-db';

function caller(db: FakeDb, userId = 'test-user') {
  return searchRouter.createCaller(fakeCtx(db, userId) as never);
}

describe('searchRouter.global (unit)', () => {
  it('rejects empty query', async () => {
    const db = makeFakeDb();
    await assert.rejects(() => caller(db).global({ query: '' }));
  });

  it('returns empty buckets when nothing matches', async () => {
    const db = makeFakeDb({
      selectResults: [
        [], // matchingShowIdsRows
        [], // performerRows
        [], // userVenueIdsRows
        [], // followedVenueIdsRows
      ],
    });
    const result = await caller(db).global({ query: 'nothing' });
    assert.deepEqual(result, { shows: [], performers: [], venues: [] });
  });

  it('skips the venue-match branch when user has no relevant venues', async () => {
    const performer = {
      id: 'p1',
      name: 'Test Artist',
      imageUrl: null,
      showCount: 2,
    };
    const db = makeFakeDb({
      selectResults: [
        [], // shows: no matches → skips findMany
        [performer], // performers
        [], // user venue ids
        [], // followed venue ids → relevantVenueIds empty, skips matchedVenues query
      ],
    });
    const result = await caller(db).global({ query: 'test' });
    assert.equal(result.shows.length, 0);
    assert.equal(result.performers.length, 1);
    assert.equal(result.performers[0].name, 'Test Artist');
    assert.deepEqual(result.venues, []);
  });

  it('falls back to "Untitled" when there is no production name or headliner', async () => {
    const showRow = {
      id: 's1',
      date: '2024-05-01',
      kind: 'concert',
      state: 'past',
      productionName: null,
      tourName: null,
      venueId: 'v1',
      venue: { id: 'v1', name: 'Test Hall', city: 'NYC' },
      showPerformers: [],
    };

    // Override the query.shows.findMany hook the fake exposes.
    const baseDb = makeFakeDb({
      selectResults: [
        [{ id: 's1', date: '2024-05-01' }], // matchingShowIdsRows
        [], // performerRows
        [], // userVenueIdsRows
        [], // followedVenueIdsRows
      ],
    });
    const db: FakeDb = {
      ...baseDb,
      query: {
        shows: { findMany: async () => [showRow] },
      },
    };

    const result = await caller(db).global({ query: 'test' });
    assert.equal(result.shows.length, 1);
    assert.equal(result.shows[0].title, 'Untitled');
  });

  it('uses production name for theatre shows when present', async () => {
    const showRow = {
      id: 's1',
      date: '2024-05-01',
      kind: 'theatre',
      state: 'past',
      productionName: 'Hamlet',
      tourName: null,
      venueId: 'v1',
      venue: { id: 'v1', name: 'Theatre', city: 'NYC' },
      showPerformers: [
        {
          role: 'headliner',
          sortOrder: 0,
          performer: { id: 'p1', name: 'Cast Member' },
        },
      ],
    };

    const baseDb = makeFakeDb({
      selectResults: [
        [{ id: 's1', date: '2024-05-01' }],
        [],
        [],
        [],
      ],
    });
    const db: FakeDb = {
      ...baseDb,
      query: { shows: { findMany: async () => [showRow] } },
    };

    const result = await caller(db).global({ query: 'hamlet' });
    assert.equal(result.shows[0].title, 'Hamlet');
  });

  it('sorts dateless shows ahead of dated ones', async () => {
    const dated = {
      id: 's-dated',
      date: '2024-05-01',
      kind: 'concert',
      state: 'past',
      productionName: null,
      tourName: null,
      venue: { id: 'v1', name: 'Hall A', city: 'NYC' },
      showPerformers: [
        { role: 'headliner', sortOrder: 0, performer: { id: 'p1', name: 'A' } },
      ],
    };
    const dateless = {
      id: 's-dateless',
      date: null,
      kind: 'concert',
      state: 'watching',
      productionName: null,
      tourName: null,
      venue: { id: 'v2', name: 'Hall B', city: 'NYC' },
      showPerformers: [
        { role: 'headliner', sortOrder: 0, performer: { id: 'p2', name: 'B' } },
      ],
    };

    const baseDb = makeFakeDb({
      selectResults: [
        [
          { id: 's-dated', date: '2024-05-01' },
          { id: 's-dateless', date: null },
        ],
        [],
        [],
        [],
      ],
    });
    const db: FakeDb = {
      ...baseDb,
      query: { shows: { findMany: async () => [dated, dateless] } },
    };

    const result = await caller(db).global({ query: 'A' });
    assert.equal(result.shows[0].id, 's-dateless');
    assert.equal(result.shows[1].id, 's-dated');
  });
});
