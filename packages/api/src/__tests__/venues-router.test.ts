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
      // upcomingCount is now derived from the deduped row scan rather than
      // a raw count(*), so the script returns rows for the scan + the
      // links/user-shows lookups inside `getDedupedUpcomingAnnouncements`.
      const upcomingRows = [
        { id: 'a1', venueId: VENUE_ID, headliner: 'Coldplay', productionName: null, showDate: '2026-08-01' },
        { id: 'a2', venueId: VENUE_ID, headliner: 'Pearl Jam', productionName: null, showDate: '2026-09-01' },
        { id: 'a3', venueId: VENUE_ID, headliner: 'Lorde', productionName: null, showDate: '2026-10-01' },
      ];
      const db = makeFakeDb({
        selectResults: [
          [venue],
          [{ venueId: VENUE_ID }], // user follows
          [{ count: 4 }], // user shows count
          upcomingRows, // scanned upcoming announcements
          [], // showAnnouncementLinks for this user+venue
          [], // user's shows at this venue (for fuzzy dedup)
          [], // loadVenueNameOverrides → no per-user alias
        ],
      });
      const result = await caller(db).detail({ venueId: VENUE_ID });
      assert.equal(result.id, VENUE_ID);
      assert.equal(result.isFollowed, true);
      assert.equal(result.userShowCount, 4);
      assert.equal(result.upcomingCount, 3);
      assert.equal(result.name, 'Test Venue');
      assert.equal(result.canonicalName, 'Test Venue');
      assert.equal(result.hasCustomName, false);
    });

    it('returns the per-user alias as name with canonicalName preserved', async () => {
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
          [{ venueId: VENUE_ID }], // follows
          [{ count: 0 }], // user show count
          [], // upcoming scan → empty, dedup skips link/user-show selects
          [{ venueId: VENUE_ID, customName: 'My Spot' }], // override exists
        ],
      });
      const result = await caller(db).detail({ venueId: VENUE_ID });
      assert.equal(result.name, 'My Spot');
      assert.equal(result.canonicalName, 'Test Venue');
      assert.equal(result.hasCustomName, true);
    });

    it('drops upcoming announcements that fuzzy-match a logged show', async () => {
      const venue = {
        id: VENUE_ID,
        name: 'Napa Valley Expo',
        city: 'Napa',
        country: 'US',
        latitude: null,
        longitude: null,
      };
      const upcomingRows = [
        {
          id: 'a1',
          venueId: VENUE_ID,
          headliner: 'Various Artists',
          productionName: 'BottleRock Napa Valley',
          showDate: '2026-05-22',
          runStartDate: null,
          runEndDate: null,
          performanceDates: null,
        },
      ];
      const db = makeFakeDb({
        selectResults: [
          [venue],
          [], // not followed
          [{ count: 1 }],
          upcomingRows,
          [], // no announcement links
          [
            {
              date: '2026-05-22',
              endDate: null,
              productionName: 'Bottlerock',
              headlinerName: null,
            },
          ],
          [], // loadVenueNameOverrides → no alias
        ],
      });
      const result = await caller(db).detail({ venueId: VENUE_ID });
      assert.equal(result.upcomingCount, 0);
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

    it('trims whitespace and upserts a per-user alias', async () => {
      const db = makeFakeDb({
        selectResults: [[{ venueId: VENUE_ID }]], // follow exists
        insertResults: [[{ customName: 'Trimmed Hall' }]], // upsert returning
      });
      const result = await caller(db).rename({
        venueId: VENUE_ID,
        name: '   Trimmed Hall   ',
      });
      assert.equal(result.name, 'Trimmed Hall');
      assert.equal(result.customName, 'Trimmed Hall');
    });

    it('authorizes via a show when there is no follow', async () => {
      const db = makeFakeDb({
        selectResults: [
          [], // no follow
          [{ id: 'show-1' }], // has a show at the venue
        ],
        insertResults: [[{ customName: 'Via Show' }]],
      });
      const result = await caller(db).rename({ venueId: VENUE_ID, name: 'Via Show' });
      assert.equal(result.name, 'Via Show');
    });
  });

  describe('resetName', () => {
    it('throws FORBIDDEN when caller has no follow and no show', async () => {
      const db = makeFakeDb({ selectResults: [[], []] });
      await assert.rejects(
        () => caller(db).resetName({ venueId: VENUE_ID }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'FORBIDDEN',
      );
    });

    it('deletes the override and returns the canonical name', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ venueId: VENUE_ID }], // follow exists
          [{ name: 'Canonical Hall' }], // canonical name lookup
        ],
      });
      const result = await caller(db).resetName({ venueId: VENUE_ID });
      assert.equal(result.name, 'Canonical Hall');
      assert.equal(result.customName, null);
    });

    it('throws NOT_FOUND when the venue is gone', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ venueId: VENUE_ID }], // follow exists
          [], // canonical lookup empty
        ],
      });
      await assert.rejects(
        () => caller(db).resetName({ venueId: VENUE_ID }),
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
        selectResults: [rows, [{ venueId: VENUE_ID }], []],
      });
      const result = await caller(db).list();
      assert.equal(result.length, 2);
      assert.equal(result.find((r) => r.id === VENUE_ID)!.isFollowed, true);
      assert.equal(result.find((r) => r.id === 'other')!.isFollowed, false);
    });

    it('applies the per-user alias over the canonical name', async () => {
      const rows = [
        { id: VENUE_ID, name: 'Canonical', city: 'NYC', stateRegion: 'NY', country: 'US', googlePlaceId: null, photoUrl: null, ticketmasterVenueId: null, pastShowsCount: 1, futureShowsCount: 0 },
      ];
      const db = makeFakeDb({
        selectResults: [
          rows,
          [], // no follows
          [{ venueId: VENUE_ID, customName: 'My Alias' }], // override
        ],
      });
      const result = await caller(db).list();
      assert.equal(result[0]!.name, 'My Alias');
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
        selectResults: [[{ id: VENUE_ID, name: 'matched' }], []],
      });
      const result = await caller(db).search({ query: 'matched' });
      assert.equal(result.length, 1);
    });

    it('surfaces the per-user alias on a canonical-name match', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: VENUE_ID, name: 'Canonical' }],
          [{ venueId: VENUE_ID, customName: 'Alias' }],
        ],
      });
      const result = await caller(db).search({ query: 'Canonical' });
      assert.equal(result[0]!.name, 'Alias');
    });
  });

  describe('upcomingAnnouncements', () => {
    it('returns announcements scripted by the fake db', async () => {
      const annos = [{ id: 'a1', headliner: 'X', showDate: '2026-08-01', productionName: null }];
      // Three select calls: raw scan, link lookup, user-show lookup. With no
      // matches the dedup is a no-op.
      const db = makeFakeDb({ selectResults: [annos, [], []] });
      const result = await caller(db).upcomingAnnouncements({ venueId: VENUE_ID });
      assert.deepEqual(result, annos);
    });

    it('drops an announcement that fuzzy-matches a logged show', async () => {
      const annos = [
        {
          id: 'a1',
          venueId: VENUE_ID,
          headliner: 'Various Artists',
          productionName: 'BottleRock Napa Valley',
          showDate: '2026-05-22',
          runStartDate: null,
          runEndDate: null,
          performanceDates: null,
        },
        {
          id: 'a2',
          venueId: VENUE_ID,
          headliner: 'Coldplay',
          productionName: null,
          showDate: '2026-06-15',
          runStartDate: null,
          runEndDate: null,
          performanceDates: null,
        },
      ];
      const db = makeFakeDb({
        selectResults: [
          annos,
          [], // no link rows
          [
            {
              date: '2026-05-22',
              endDate: null,
              productionName: 'Bottlerock',
              headlinerName: null,
            },
          ],
        ],
      });
      const result = await caller(db).upcomingAnnouncements({ venueId: VENUE_ID });
      assert.deepEqual(result.map((a: { id: string }) => a.id), ['a2']);
    });

    it('drops an announcement explicitly linked to a user show', async () => {
      const annos = [{ id: 'a1', headliner: 'X', showDate: '2026-08-01', productionName: null }];
      const db = makeFakeDb({
        selectResults: [annos, [{ announcementId: 'a1' }], []],
      });
      const result = await caller(db).upcomingAnnouncements({ venueId: VENUE_ID });
      assert.equal(result.length, 0);
    });
  });

  describe('saveScrapeConfig', () => {
    it('throws FORBIDDEN when caller has no follow and no show at the venue', async () => {
      const db = makeFakeDb({ selectResults: [[], []] });
      await assert.rejects(
        () =>
          caller(db).saveScrapeConfig({
            venueId: VENUE_ID,
            config: { url: 'https://example.com', frequencyDays: 3 },
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'FORBIDDEN',
      );
    });

    it('clears the config when null is passed', async () => {
      const db = makeFakeDb({ selectResults: [[{ venueId: VENUE_ID }]] }); // follow exists
      const result = await caller(db).saveScrapeConfig({
        venueId: VENUE_ID,
        config: null,
      });
      assert.deepEqual(result, { success: true });
    });

    it('accepts a parsed config', async () => {
      const db = makeFakeDb({ selectResults: [[{ venueId: VENUE_ID }]] }); // follow exists
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

    it('rejects SSRF / non-public URLs (file://, localhost, private IP, metadata)', async () => {
      // Follow exists, so authorization passes — the SSRF guard in the input
      // schema is what must reject these, not the access gate.
      for (const url of [
        'file:///etc/passwd',
        'http://localhost:3002/api/admin/sql',
        'http://127.0.0.1/',
        'http://169.254.169.254/latest/meta-data/',
        'http://192.168.1.1/',
      ]) {
        const db = makeFakeDb({ selectResults: [[{ venueId: VENUE_ID }]] });
        await assert.rejects(
          () =>
            caller(db).saveScrapeConfig({
              venueId: VENUE_ID,
              config: { url, frequencyDays: 7 },
            }),
          `${url} should be rejected`,
        );
      }
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

  // `backfillCoordinates` and `backfillTicketmaster` moved to
  // `adminRouter` (see `__tests__/admin-router.test.ts`); they're no
  // longer reachable on `venuesRouter`.

  describe('followed', () => {
    it('returns the bare venue rows the user follows', async () => {
      const db = makeFakeDb({ selectResults: [[]] }); // loadVenueNameOverrides → none
      (db as unknown as {
        query: { userVenueFollows: { findMany: () => Promise<unknown[]> } };
      }).query = {
        userVenueFollows: {
          findMany: async () => [{ venue: { id: VENUE_ID, name: 'V' } }],
        } as never,
      };
      const result = await caller(db).followed();
      assert.equal(result.length, 1);
      assert.equal(result[0]!.name, 'V');
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
    it('throws FORBIDDEN when caller has no follow and no show at the venue', async () => {
      const db = makeFakeDb({ selectResults: [[], []] });
      await assert.rejects(
        () => caller(db).scrapeStatus({ venueId: VENUE_ID }),
        (err: unknown) => err instanceof TRPCError && err.code === 'FORBIDDEN',
      );
    });

    it('throws NOT_FOUND when venue does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[{ venueId: VENUE_ID }], []] }); // follow exists, venue missing
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
          [{ venueId: VENUE_ID }], // follow exists
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
          [{ venueId: VENUE_ID }], // follow exists
          [{ scrapeConfig: null }],
          [],
        ],
      });
      const result = await caller(db).scrapeStatus({ venueId: VENUE_ID });
      assert.equal(result.lastRun, null);
    });
  });
});
