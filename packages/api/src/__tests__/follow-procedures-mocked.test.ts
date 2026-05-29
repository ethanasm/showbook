/**
 * Unit tests for the follow / unfollow / followAttraction procedures
 * across performers and venues. These call into the job-queue and the
 * matchers, so we mock those modules to keep the tests in-process.
 */

import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';

mock.module('../job-queue.js', {
  namedExports: {
    enqueueIngestVenue: async () => 'job-1',
    enqueueIngestPerformer: async () => 'job-2',
    enqueueIngestRegion: async () => 'job-3',
    isRegionIngestPending: async () => false,
    getPendingIngests: async () => ({ venues: [], performers: [], regions: [] }),
  },
});

mock.module('../performer-matcher.js', {
  namedExports: {
    matchOrCreatePerformer: async (input: { name: string }) => ({
      performer: { id: `perf-${input.name}`, name: input.name },
      created: false,
    }),
  },
});

mock.module('../geocode.js', {
  namedExports: {
    geocodeVenue: async () => null,
  },
});

mock.module('../venue-matcher.js', {
  namedExports: {
    matchOrCreateVenue: async (input: { name: string; city: string }) => ({
      venue: { id: 'v1', name: input.name, city: input.city },
      created: false,
    }),
    findTmVenueId: async () => null,
  },
});

mock.module('../google-places.js', {
  namedExports: {
    getPlaceDetails: async (placeId: string) => {
      if (placeId === 'missing') return null;
      return {
        name: 'Greek',
        city: 'Berkeley',
        stateRegion: 'CA',
        country: 'US',
        latitude: 37.8,
        longitude: -122.2,
        googlePlaceId: placeId,
        photoUrl: 'https://photo',
      };
    },
  },
});

let performersRouter: typeof import('../routers/performers').performersRouter;
let venuesRouter: typeof import('../routers/venues').venuesRouter;
let preferencesRouter: typeof import('../routers/preferences').preferencesRouter;
let makeFakeDb: typeof import('./_fake-db').makeFakeDb;
let fakeCtx: typeof import('./_fake-db').fakeCtx;

before(async () => {
  ({ performersRouter } = await import('../routers/performers'));
  ({ venuesRouter } = await import('../routers/venues'));
  ({ preferencesRouter } = await import('../routers/preferences'));
  ({ makeFakeDb, fakeCtx } = await import('./_fake-db'));
});

const VENUE_ID = '11111111-1111-4111-8111-111111111111';
const PERFORMER_ID = '22222222-2222-4222-8222-222222222222';

describe('performersRouter.follow / followAttraction (mocked)', () => {
  it('follow returns success', async () => {
    // selectResults: [followed-performers cap check].
    const db = makeFakeDb({ selectResults: [[]] });
    const result = await performersRouter
      .createCaller(fakeCtx(db) as never)
      .follow({ performerId: PERFORMER_ID });
    assert.deepEqual(result, { success: true, performerId: PERFORMER_ID });
  });

  it('follow rejects once the artist cap is reached', async () => {
    // 250 existing follows, none matching the target → over cap.
    const followed = Array.from({ length: 250 }, (_, i) => ({ performerId: `p-${i}` }));
    const db = makeFakeDb({ selectResults: [followed] });
    await assert.rejects(
      () =>
        performersRouter
          .createCaller(fakeCtx(db) as never)
          .follow({ performerId: PERFORMER_ID }),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });

  it('follow at cap is still idempotent for an already-followed artist', async () => {
    const followed = Array.from({ length: 250 }, (_, i) => ({ performerId: `p-${i}` }));
    followed[0] = { performerId: PERFORMER_ID };
    const db = makeFakeDb({ selectResults: [followed] });
    const result = await performersRouter
      .createCaller(fakeCtx(db) as never)
      .follow({ performerId: PERFORMER_ID });
    assert.deepEqual(result, { success: true, performerId: PERFORMER_ID });
  });

  it('followAttraction resolves a TM attraction → performer + follow', async () => {
    // selectResults: [followed-performers cap check].
    const db = makeFakeDb({ selectResults: [[]] });
    const result = await performersRouter
      .createCaller(fakeCtx(db) as never)
      .followAttraction({
        tmAttractionId: 'tm-1',
        name: 'Phoebe',
      });
    assert.equal(result.performerId, 'perf-Phoebe');
  });

  it('followAttraction rejects once the artist cap is reached', async () => {
    // matchOrCreatePerformer is mocked to return perf-Phoebe; 250 other
    // follows means adding this new one would breach the cap.
    const followed = Array.from({ length: 250 }, (_, i) => ({ performerId: `p-${i}` }));
    const db = makeFakeDb({ selectResults: [followed] });
    await assert.rejects(
      () =>
        performersRouter
          .createCaller(fakeCtx(db) as never)
          .followAttraction({ tmAttractionId: 'tm-1', name: 'Phoebe' }),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });
});

describe('venuesRouter.follow / createFromPlace (mocked)', () => {
  it('follow inserts and lazy-backfills with no Place id update', async () => {
    // selectResults: [followed-venues cap check, venue row for backfill].
    const db = makeFakeDb({
      selectResults: [
        [],
        [{ name: 'V', city: 'C', stateRegion: null, googlePlaceId: 'have', photoUrl: 'have' }],
      ],
    });
    const result = await venuesRouter
      .createCaller(fakeCtx(db) as never)
      .follow({ venueId: VENUE_ID });
    assert.deepEqual(result, { success: true });
  });

  it('follow rejects once the venue cap is reached', async () => {
    const followed = Array.from({ length: 100 }, (_, i) => ({ venueId: `v-${i}` }));
    const db = makeFakeDb({ selectResults: [followed] });
    await assert.rejects(
      () =>
        venuesRouter
          .createCaller(fakeCtx(db) as never)
          .follow({ venueId: VENUE_ID }),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });

  it('createFromPlace returns the matched venue', async () => {
    const db = makeFakeDb();
    const result = await venuesRouter
      .createCaller(fakeCtx(db) as never)
      .createFromPlace({ placeId: 'place-1' });
    assert.equal((result as { id: string }).id, 'v1');
  });

  it('createFromPlace throws when place is not found', async () => {
    const db = makeFakeDb();
    await assert.rejects(() =>
      venuesRouter
        .createCaller(fakeCtx(db) as never)
        .createFromPlace({ placeId: 'missing' }),
    );
  });
});

describe('preferencesRouter.addRegion (happy path with mocked queue)', () => {
  it('inserts a new region and enqueues ingest', async () => {
    const db = makeFakeDb({
      selectResults: [[]], // existing regions = 0
      insertResults: [
        [
          {
            id: '33333333-3333-4333-8333-333333333333',
            userId: 'test-user',
            cityName: 'NYC',
            latitude: 40.7,
            longitude: -74,
            radiusMiles: 25,
            active: true,
          },
        ],
      ],
    });
    const result = await preferencesRouter
      .createCaller(fakeCtx(db) as never)
      .addRegion({
        cityName: 'NYC',
        latitude: 40.7,
        longitude: -74,
        radiusMiles: 25,
      });
    assert.equal(result.cityName, 'NYC');
    assert.equal(result.ingestJobId, 'job-3');
  });

  it('toggleRegion re-enqueues when reactivating', async () => {
    const existing = {
      id: '44444444-4444-4444-8444-444444444444',
      userId: 'test-user',
      cityName: 'LA',
      latitude: 34,
      longitude: -118,
      radiusMiles: 25,
      active: false,
    };
    const updated = { ...existing, active: true };
    const db = makeFakeDb({
      selectResults: [[existing]],
      updateResults: [[updated]],
    });
    const result = await preferencesRouter
      .createCaller(fakeCtx(db) as never)
      .toggleRegion({ regionId: existing.id });
    assert.equal(result.active, true);
  });
});
