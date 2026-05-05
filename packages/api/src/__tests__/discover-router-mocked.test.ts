/**
 * Unit tests for the discover router. Most procedures use the imported
 * `db` global (not `ctx.db`); we replace just that symbol while keeping
 * the rest of @showbook/db (table objects, drizzle helpers) intact, so
 * `eq()` etc. and the auth middleware (which selects from `users` via
 * ctx.db) continue to work against an in-memory fake.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import * as realDb from '@showbook/db';

interface Script {
  selectResults: unknown[][];
  insertCount: number;
  updateCount: number;
  deleteCount: number;
}
const SCRIPT: Script = {
  selectResults: [],
  insertCount: 0,
  updateCount: 0,
  deleteCount: 0,
};
function reset(opts: Partial<Script> = {}) {
  SCRIPT.selectResults = opts.selectResults ?? [];
  SCRIPT.insertCount = 0;
  SCRIPT.updateCount = 0;
  SCRIPT.deleteCount = 0;
}

function mkChain(getResult: () => unknown) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') {
        const value = getResult();
        return (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve);
      }
      return () => proxy;
    },
  };
  const proxy: object = new Proxy({}, handler);
  return proxy;
}

const fakeDb = {
  select: () => mkChain(() => SCRIPT.selectResults.shift() ?? []),
  selectDistinct: () => mkChain(() => SCRIPT.selectResults.shift() ?? []),
  insert: () => mkChain(() => {
    SCRIPT.insertCount += 1;
    return [{ id: 'inserted-1' }];
  }),
  update: () => mkChain(() => {
    SCRIPT.updateCount += 1;
    return [];
  }),
  delete: () => mkChain(() => {
    SCRIPT.deleteCount += 1;
    return [];
  }),
  transaction: async (fn: (tx: unknown) => unknown) => fn(fakeDb),
};

mock.module('@showbook/db', {
  namedExports: {
    ...realDb,
    db: fakeDb,
  },
});

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

mock.module('../ticketmaster.js', {
  namedExports: {
    searchAttractions: async () => [],
    selectBestImage: () => null,
  },
});

let discoverRouter: typeof import('../routers/discover').discoverRouter;

before(async () => {
  ({ discoverRouter } = await import('../routers/discover'));
});

beforeEach(() => reset());

function caller(userId = 'test-user') {
  // For ctx.db (auth middleware lookup) we point at our fakeDb. Auth
  // expects [{id}] — provide that.
  const ctx = {
    db: fakeDb,
    session: { user: { id: userId } },
  };
  // Pre-prime an auth result for this call.
  return {
    call: <T>(proc: (c: ReturnType<typeof discoverRouter.createCaller>) => Promise<T>) => {
      // Push the auth row to the front of the queue.
      SCRIPT.selectResults.unshift([{ id: userId }]);
      return proc(discoverRouter.createCaller(ctx as never));
    },
  };
}

describe('discoverRouter (with mocked db)', () => {
  describe('followedFeed', () => {
    it('returns empty feed when user follows no venues', async () => {
      reset({ selectResults: [[]] });
      const result = await caller().call((c) => c.followedFeed({}));
      assert.deepEqual(result.items, []);
    });
  });

  describe('followedArtistsFeed', () => {
    it('returns empty feed when user follows no artists', async () => {
      reset({ selectResults: [[]] });
      const result = await caller().call((c) => c.followedArtistsFeed({}));
      assert.deepEqual(result.items, []);
    });
  });

  describe('nearbyFeed', () => {
    it('returns empty when user has no regions', async () => {
      reset({ selectResults: [[]] });
      const result = await caller().call((c) => c.nearbyFeed({}));
      assert.deepEqual(result.items, []);
      assert.equal(result.hasRegions, false);
    });
  });

  describe('regionIngestStatus', () => {
    it('throws NOT_FOUND when region is not the user’s', async () => {
      reset({ selectResults: [[]] });
      await assert.rejects(
        () =>
          caller().call((c) =>
            c.regionIngestStatus({ regionId: '11111111-1111-4111-8111-111111111111' }),
          ),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('returns pending=false when not pending', async () => {
      reset({ selectResults: [[{ id: 'r1' }]] });
      const result = await caller().call((c) =>
        c.regionIngestStatus({ regionId: '11111111-1111-4111-8111-111111111111' }),
      );
      assert.equal(result.pending, false);
    });
  });

  describe('ingestStatus', () => {
    it('returns the snapshot from getPendingIngests', async () => {
      reset({ selectResults: [[], [], []] });
      const result = await caller().call((c) => c.ingestStatus());
      assert.deepEqual(result, { venues: [], performers: [], regions: [] });
    });
  });

  describe('searchArtists', () => {
    it('returns [] when upstream returns empty', async () => {
      reset();
      const result = await caller().call((c) =>
        c.searchArtists({ keyword: 'whatever' }),
      );
      assert.deepEqual(result, []);
    });
  });

  describe('followedFeed pagination', () => {
    it('emits null ticketUrl when neither stored nor sourceEventId is set', async () => {
      const a = {
        id: 'a',
        venueId: 'v1',
        showDate: '2026-08-01',
        ticketUrl: null,
        sourceEventId: null,
      };
      reset({
        selectResults: [
          [{ venueId: 'v1' }],
          [{ announcement: a, venue: { id: 'v1', name: 'V' } }],
        ],
      });
      const result = await caller().call((c) =>
        c.followedFeed({ limit: 10 }),
      );
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.ticketUrl, null);
    });
  });

  describe('followedArtistsFeed pagination', () => {
    it('emits a nextCursor when results overflow the limit', async () => {
      const a1 = {
        id: 'a1',
        venueId: 'v1',
        showDate: '2026-08-01',
        ticketUrl: null,
        sourceEventId: 'evt-1',
      };
      const a2 = {
        id: 'a2',
        venueId: 'v1',
        showDate: '2026-08-02',
        ticketUrl: null,
        sourceEventId: null,
      };
      reset({
        selectResults: [
          [{ performerId: 'p1' }],
          [
            { announcement: a1, venue: { id: 'v1', name: 'V' } },
            { announcement: a2, venue: { id: 'v1', name: 'V' } },
          ],
        ],
      });
      const result = await caller().call((c) =>
        c.followedArtistsFeed({ limit: 1 }),
      );
      assert.equal(result.items.length, 1);
      assert.ok(result.nextCursor);
    });
  });

  describe('nearbyFeed cursor handling', () => {
    it('honors a per-region cursor and assigns to smallest matching region', async () => {
      const r1 = {
        id: 'r1',
        cityName: 'NYC',
        latitude: 40.7,
        longitude: -74,
        radiusMiles: 50,
      };
      const r2 = {
        id: 'r2',
        cityName: 'NYC small',
        latitude: 40.7,
        longitude: -74,
        radiusMiles: 5,
      };
      const venue = { id: 'v', name: 'V', latitude: 40.7, longitude: -74 };
      const announcement = {
        id: 'a1',
        venueId: 'v',
        showDate: '2026-08-01',
        ticketUrl: null,
        sourceEventId: null,
      };
      reset({
        selectResults: [
          [r1, r2],
          [], // followedVenues
          [{ announcement, venue }],
        ],
      });
      const result = await caller().call((c) =>
        c.nearbyFeed({}),
      );
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.regionId, 'r2'); // smaller region wins
    });
  });

  describe('watchlist', () => {
    it('throws when announcement is not found', async () => {
      reset({ selectResults: [[]] });
      await assert.rejects(() =>
        caller().call((c) =>
          c.watchlist({ announcementId: '11111111-1111-4111-8111-111111111111' }),
        ),
      );
    });

    for (const kind of ['sports', 'film', 'unknown'] as const) {
      it(`rejects ${kind} announcements`, async () => {
        reset({
          selectResults: [
            [
              {
                id: 'a1',
                kind,
                headliner: 'Yankees',
                venueId: 'v1',
                showDate: '2026-08-01',
                runStartDate: null,
                runEndDate: null,
                headlinerPerformerId: null,
                ticketUrl: null,
                productionName: null,
              },
            ],
          ],
        });
        await assert.rejects(
          () =>
            caller().call((c) =>
              c.watchlist({
                announcementId: '11111111-1111-4111-8111-111111111111',
              }),
            ),
          (err: unknown) =>
            err instanceof TRPCError && err.code === 'BAD_REQUEST',
        );
      });
    }

    it('creates a watching show for a single-night announcement', async () => {
      reset({
        selectResults: [
          [
            {
              id: 'a1',
              kind: 'concert',
              headliner: 'Phoebe',
              venueId: 'v1',
              showDate: '2026-08-01',
              runStartDate: '2026-08-01',
              runEndDate: '2026-08-01',
              headlinerPerformerId: 'p1',
              ticketUrl: null,
              productionName: null,
            },
          ],
        ],
      });
      const result = await caller().call((c) =>
        c.watchlist({ announcementId: '11111111-1111-4111-8111-111111111111' }),
      );
      assert.ok(result);
    });

    it('uses null date for a multi-night non-festival run', async () => {
      reset({
        selectResults: [
          [
            {
              id: 'a1',
              kind: 'theatre',
              headliner: 'Hamilton',
              venueId: 'v1',
              showDate: '2026-08-01',
              runStartDate: '2026-08-01',
              runEndDate: '2026-08-05',
              headlinerPerformerId: null,
              ticketUrl: null,
              productionName: 'Hamilton',
            },
          ],
        ],
      });
      const result = await caller().call((c) =>
        c.watchlist({ announcementId: '11111111-1111-4111-8111-111111111111' }),
      );
      assert.ok(result);
    });
  });

  describe('pickDate', () => {
    it('throws NOT_FOUND when show does not belong to user', async () => {
      reset({ selectResults: [[]] });
      await assert.rejects(
        () =>
          caller().call((c) =>
            c.pickDate({
              showId: '11111111-1111-4111-8111-111111111111',
              performanceDate: '2026-08-01',
            }),
          ),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('updates the date when ownership matches', async () => {
      reset({ selectResults: [[{ id: 's1', userId: 'test-user' }]] });
      const result = await caller().call((c) =>
        c.pickDate({
          showId: '11111111-1111-4111-8111-111111111111',
          performanceDate: '2026-08-15',
        }),
      );
      assert.deepEqual(result, { success: true });
    });
  });

  describe('refreshNow', () => {
    it('enqueues ingest jobs for followed venues + performers', async () => {
      reset({
        selectResults: [
          [{ venueId: 'v1' }, { venueId: 'v2' }],
          [{ performerId: 'p1' }],
        ],
      });
      const userId = `refresh-user-${Math.random()}`;
      const result = await caller(userId).call((c) => c.refreshNow());
      assert.equal(result.enqueuedVenues, 2);
      assert.equal(result.enqueuedPerformers, 1);
    });

    it('throws TOO_MANY_REQUESTS when called twice in cooldown', async () => {
      const userId = `cooldown-${Math.random()}`;
      reset({ selectResults: [[], []] });
      await caller(userId).call((c) => c.refreshNow());
      reset();
      await assert.rejects(
        () => caller(userId).call((c) => c.refreshNow()),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
      );
    });
  });

  describe('watchlist (festival)', () => {
    it('uses runStartDate/runEndDate for festival', async () => {
      reset({
        selectResults: [
          [
            {
              id: 'a-fest',
              kind: 'festival',
              headliner: 'Outside Lands',
              venueId: 'v-park',
              showDate: '2026-08-08',
              runStartDate: '2026-08-08',
              runEndDate: '2026-08-10',
              headlinerPerformerId: 'p-fest',
              ticketUrl: null,
              productionName: 'Outside Lands 2026',
            },
          ],
        ],
      });
      const result = await caller().call((c) =>
        c.watchlist({ announcementId: '11111111-1111-4111-8111-111111111111' }),
      );
      assert.ok(result);
    });

    it('uses an explicit performance date when provided', async () => {
      reset({
        selectResults: [
          [
            {
              id: 'a-multi',
              kind: 'theatre',
              headliner: 'Hamilton',
              venueId: 'v-richard',
              showDate: '2026-09-01',
              runStartDate: '2026-09-01',
              runEndDate: '2026-09-30',
              headlinerPerformerId: null,
              ticketUrl: null,
              productionName: 'Hamilton',
            },
          ],
        ],
      });
      const result = await caller().call((c) =>
        c.watchlist({
          announcementId: '11111111-1111-4111-8111-111111111111',
          performanceDate: '2026-09-15',
        }),
      );
      assert.ok(result);
    });
  });

  describe('unwatchlist', () => {
    it('throws when no watchlist entry found', async () => {
      reset({ selectResults: [[]] });
      await assert.rejects(() =>
        caller().call((c) =>
          c.unwatchlist({
            announcementId: '11111111-1111-4111-8111-111111111111',
          }),
        ),
      );
    });

    it('deletes the linked show when found', async () => {
      reset({ selectResults: [[{ showId: 's1' }]] });
      const result = await caller().call((c) =>
        c.unwatchlist({ announcementId: '11111111-1111-4111-8111-111111111111' }),
      );
      assert.deepEqual(result, { success: true });
    });
  });
});
