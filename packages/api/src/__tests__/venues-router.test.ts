/**
 * Unit tests for the venues tRPC router. Covers the early-throw paths
 * (NOT_FOUND, FORBIDDEN), the rename trim, and unfollow's
 * orphan-deletion bookkeeping. The rest of the router is thin SQL glue
 * better exercised end-to-end (or via the existing nearby-feed
 * integration test).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { venuesRouter } from '../routers/venues';
import { makeFakeDb, fakeCtx, type FakeDb } from './_fake-db';

function caller(db: FakeDb, userId = 'test-user') {
  return venuesRouter.createCaller(fakeCtx(db, userId) as never);
}

const VENUE_ID = '11111111-1111-4111-8111-111111111111';

describe('venuesRouter (unit)', () => {
  describe('detail', () => {
    it('throws NOT_FOUND when the venue does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () => caller(db).detail({ venueId: VENUE_ID }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('returns isFollowed and counts when the venue exists', async () => {
      const venue = {
        id: VENUE_ID,
        name: 'Test Venue',
        city: 'NYC',
        country: 'US',
        latitude: null,
        longitude: null,
      };
      const db = makeFakeDb({
        selectResults: [
          [venue],
          [{ venueId: VENUE_ID }], // user follows
          [{ count: 4 }], // user shows count
          [{ count: 9 }], // upcoming announcements
        ],
      });
      const result = await caller(db).detail({ venueId: VENUE_ID });
      assert.equal(result.id, VENUE_ID);
      assert.equal(result.isFollowed, true);
      assert.equal(result.userShowCount, 4);
      assert.equal(result.upcomingCount, 9);
    });
  });

  describe('rename', () => {
    it('throws FORBIDDEN when caller has no follow and no show', async () => {
      const db = makeFakeDb({ selectResults: [[], []] });
      await assert.rejects(
        () => caller(db).rename({ venueId: VENUE_ID, name: 'X' }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'FORBIDDEN',
      );
    });

    it('trims whitespace and returns the updated row', async () => {
      const updated = { id: VENUE_ID, name: 'Trimmed Hall' };
      const db = makeFakeDb({
        selectResults: [[{ venueId: VENUE_ID }]], // follow exists
        updateResults: [[updated]],
      });
      const result = await caller(db).rename({
        venueId: VENUE_ID,
        name: '   Trimmed Hall   ',
      });
      assert.equal(result.name, 'Trimmed Hall');
    });

    it('throws NOT_FOUND when update returns nothing', async () => {
      const db = makeFakeDb({
        selectResults: [[{ venueId: VENUE_ID }]],
        updateResults: [[]],
      });
      await assert.rejects(
        () => caller(db).rename({ venueId: VENUE_ID, name: 'x' }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });
  });

  describe('search', () => {
    it('rejects empty query', async () => {
      const db = makeFakeDb();
      await assert.rejects(() => caller(db).search({ query: '' }));
    });
  });

  describe('list', () => {
    it('joins follow set onto venue rows and returns isFollowed flag', async () => {
      const rows = [
        { id: VENUE_ID, name: 'V', city: 'NYC', stateRegion: 'NY', country: 'US', googlePlaceId: null, photoUrl: null, ticketmasterVenueId: null, pastShowsCount: 1, futureShowsCount: 0 },
        { id: 'other', name: 'Other', city: 'LA', stateRegion: 'CA', country: 'US', googlePlaceId: null, photoUrl: null, ticketmasterVenueId: null, pastShowsCount: 0, futureShowsCount: 1 },
      ];
      const db = makeFakeDb({
        selectResults: [rows, [{ venueId: VENUE_ID }]],
      });
      const result = await caller(db).list();
      assert.equal(result.length, 2);
      assert.equal(result.find((r) => r.id === VENUE_ID)!.isFollowed, true);
      assert.equal(result.find((r) => r.id === 'other')!.isFollowed, false);
    });
  });

  describe('count', () => {
    it('returns count from row', async () => {
      const db = makeFakeDb({ selectResults: [[{ count: 7 }]] });
      const result = await caller(db).count();
      assert.equal(result, 7);
    });

    it('returns 0 when no row', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).count();
      assert.equal(result, 0);
    });
  });

  describe('search', () => {
    it('runs an ilike query when query is provided', async () => {
      const db = makeFakeDb({
        selectResults: [[{ id: VENUE_ID, name: 'matched' }]],
      });
      const result = await caller(db).search({ query: 'matched' });
      assert.equal(result.length, 1);
    });
  });

  describe('upcomingAnnouncements', () => {
    it('returns announcements scripted by the fake db', async () => {
      const annos = [{ id: 'a1', headliner: 'X' }];
      const db = makeFakeDb({ selectResults: [annos] });
      const result = await caller(db).upcomingAnnouncements({ venueId: VENUE_ID });
      assert.deepEqual(result, annos);
    });
  });

  describe('saveScrapeConfig', () => {
    it('clears the config when null is passed', async () => {
      const db = makeFakeDb();
      const result = await caller(db).saveScrapeConfig({
        venueId: VENUE_ID,
        config: null,
      });
      assert.deepEqual(result, { success: true });
    });

    it('accepts a parsed config', async () => {
      const db = makeFakeDb();
      const result = await caller(db).saveScrapeConfig({
        venueId: VENUE_ID,
        config: { url: 'https://example.com', frequencyDays: 3 },
      });
      assert.deepEqual(result, { success: true });
    });

    it('rejects invalid url', async () => {
      const db = makeFakeDb();
      await assert.rejects(() =>
        caller(db).saveScrapeConfig({
          venueId: VENUE_ID,
          config: { url: 'not-a-url', frequencyDays: 7 },
        }),
      );
    });
  });

  describe('unfollow', () => {
    it('returns deleted=false when the venue still exists after unfollow', async () => {
      const db = makeFakeDb({
        selectResults: [
          // stillFollowed lookup → empty
          [],
          // candidate announcements at this venue → none
          [],
          // venueStillExists → row
          [{ id: VENUE_ID }],
        ],
      });
      const result = await caller(db).unfollow({ venueId: VENUE_ID });
      assert.equal(result.success, true);
      assert.equal(result.deleted, false);
    });

    it('returns deleted=true when the venue was orphan-deleted', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ userId: 'someone-else' }], // somebody still follows — skip cleanup branch
          [], // venueStillExists → empty
        ],
      });
      const result = await caller(db).unfollow({ venueId: VENUE_ID });
      assert.equal(result.deleted, true);
    });

    it('runs the cleanup branch with candidate announcements', async () => {
      const candidate = {
        id: 'a1',
        venueId: VENUE_ID,
        headlinerPerformerId: null,
        supportPerformerIds: null,
        venueLat: 40.7,
        venueLng: -74,
      };
      const db = makeFakeDb({
        selectResults: [
          [], // stillFollowed empty (last user)
          [candidate], // candidate announcements
          [{ latitude: 34, longitude: -118, radiusMiles: 25 }], // active regions
          [{ performerId: 'p1' }], // followed performers
          [{ id: VENUE_ID }], // venueStillExists
        ],
      });
      const result = await caller(db).unfollow({ venueId: VENUE_ID });
      assert.equal(result.success, true);
    });
  });

  // `follow` is not unit-tested here because it calls
  // `enqueueIngestVenue`, which opens a pg-boss connection that stalls
  // the unit-test event loop. The integration suite covers that path.

  describe('backfillCoordinates', () => {
    it('returns zeros when no incomplete rows', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).backfillCoordinates();
      assert.equal(result.total, 0);
      assert.equal(result.geocoded, 0);
      assert.equal(result.failed, 0);
    });
  });

  describe('backfillTicketmaster', () => {
    it('returns zeros when no rows are missing TM id', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).backfillTicketmaster();
      assert.equal(result.total, 0);
      assert.equal(result.matched, 0);
    });
  });

  describe('followed', () => {
    it('returns the bare venue rows the user follows', async () => {
      const db = makeFakeDb();
      (db as unknown as {
        query: { userVenueFollows: { findMany: () => Promise<unknown[]> } };
      }).query = {
        userVenueFollows: {
          findMany: async () => [{ venue: { id: VENUE_ID, name: 'V' } }],
        } as never,
      };
      const result = await caller(db).followed();
      assert.equal(result.length, 1);
    });
  });

  describe('userShows', () => {
    it('passes through findMany result', async () => {
      const db = makeFakeDb();
      (db as unknown as {
        query: { shows: { findMany: () => Promise<unknown[]> } };
      }).query = {
        shows: { findMany: async () => [{ id: 's1' }] } as never,
      };
      const result = await caller(db).userShows({ venueId: VENUE_ID });
      assert.equal(result.length, 1);
    });
  });

  describe('scrapeStatus', () => {
    it('throws NOT_FOUND when venue does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () => caller(db).scrapeStatus({ venueId: VENUE_ID }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('returns the parsed config and last run when found', async () => {
      const config = { type: 'llm' as const, url: 'https://example.com', frequencyDays: 7 };
      const lastRun = { id: 'r1', venueId: VENUE_ID, startedAt: new Date(), status: 'success' };
      const db = makeFakeDb({
        selectResults: [
          [{ scrapeConfig: config }],
          [lastRun],
        ],
      });
      const result = await caller(db).scrapeStatus({ venueId: VENUE_ID });
      assert.deepEqual(result.config, config);
      assert.equal(result.lastRun?.id, 'r1');
    });

    it('returns null lastRun when no runs exist', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ scrapeConfig: null }],
          [],
        ],
      });
      const result = await caller(db).scrapeStatus({ venueId: VENUE_ID });
      assert.equal(result.lastRun, null);
    });
  });
});
