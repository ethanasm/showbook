/**
 * Integration coverage for routers/venues.ts. Hits list, count, search,
 * follow/unfollow, rename, detail, followed, userShows, and the read
 * paths around scrapeStatus / upcomingAnnouncements.
 *
 * createFromPlace, backfillCoordinates, backfillTicketmaster all hit
 * external HTTP — we leave those to dedicated unit tests / skip here.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     node --import tsx --test src/__tests__/venues.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';

// Stub pg-boss so follow mutations don't keep the process alive.
const __globals = globalThis as unknown as {
  __showbookBoss?: { send: () => Promise<string | null>; start: () => Promise<void> };
};
__globals.__showbookBoss = {
  send: async () => 'fake-job-id',
  start: async () => {},
};

// Stub fetch — venues.follow tries to backfill googlePlaceId via
// geocodeVenue (HTTP). The router catches errors, so a throwing fetch is
// safe and keeps the test offline.
const __originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error('network disabled (test stub)');
}) as typeof globalThis.fetch;

import {
  db,
  venues,
  userVenueFollows,
  announcements,
} from '@showbook/db';
import { eq, and, sql } from 'drizzle-orm';
import {
  callerFor,
  cleanupByPrefix,
  createTestShow,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'cc222222';

const USER_A = `${PREFIX}-user-a`;
const USER_B = `${PREFIX}-user-b`;

const VENUE_WITH_SHOWS = fakeUuid(PREFIX, 'vws');
const VENUE_FOLLOWED_ONLY = fakeUuid(PREFIX, 'vfo');
const VENUE_FOR_RENAME = fakeUuid(PREFIX, 'vrn');
const VENUE_FOR_DETAIL = fakeUuid(PREFIX, 'vdt');
const VENUE_UNAUTHORIZED = fakeUuid(PREFIX, 'vun');
const VENUE_FOR_FOLLOW = fakeUuid(PREFIX, 'vff');
const VENUE_FOR_UNFOLLOW = fakeUuid(PREFIX, 'vuf');
const VENUE_SEARCH = fakeUuid(PREFIX, 'vsrch');

const SHOW_PAST = fakeUuid(PREFIX, 'spast');
const SHOW_FUTURE = fakeUuid(PREFIX, 'sftr');

const ANN_UPCOMING = fakeUuid(PREFIX, 'aup');
const ANN_PAST = fakeUuid(PREFIX, 'apt');

async function preCleanup(): Promise<void> {
  const p = `${PREFIX}%`;
  await db.execute(
    sql`DELETE FROM user_venue_follows WHERE venue_id IN (SELECT id FROM venues WHERE id::text LIKE ${p})`,
  );
  await db.execute(
    sql`DELETE FROM user_performer_follows WHERE performer_id IN (SELECT id FROM performers WHERE id::text LIKE ${p})`,
  );
}

describe('venues router', () => {
  before(async () => {
    await preCleanup();
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER_A);
    await createTestUser(USER_B);

    await createTestVenue({
      id: VENUE_WITH_SHOWS,
      name: `${PREFIX} With Shows`,
      city: 'NYC',
      latitude: 40.7128,
      longitude: -74.006,
      stateRegion: 'NY',
    });
    await createTestVenue({
      id: VENUE_FOLLOWED_ONLY,
      name: `${PREFIX} Followed Only`,
      city: 'LA',
      latitude: 34.05,
      longitude: -118.25,
    });
    await createTestVenue({
      id: VENUE_FOR_RENAME,
      name: `${PREFIX} OldRenameName`,
      city: 'Chicago',
    });
    await createTestVenue({
      id: VENUE_FOR_DETAIL,
      name: `${PREFIX} Detail Venue`,
      city: 'NYC',
      latitude: 40.7128,
      longitude: -74.006,
    });
    await createTestVenue({
      id: VENUE_UNAUTHORIZED,
      name: `${PREFIX} Unauthorized Venue`,
      city: 'Boston',
    });
    await createTestVenue({
      id: VENUE_FOR_FOLLOW,
      name: `${PREFIX} For Follow`,
      city: 'Seattle',
    });
    await createTestVenue({
      id: VENUE_FOR_UNFOLLOW,
      name: `${PREFIX} For Unfollow`,
      city: 'Honolulu',
      latitude: 21.3,
      longitude: -157.85,
    });
    await createTestVenue({
      id: VENUE_SEARCH,
      name: `${PREFIX} SearchUniqueXyz`,
      city: 'Denver',
    });

    // USER_A has shows at VENUE_WITH_SHOWS (past + future) and
    // VENUE_FOR_DETAIL.
    await createTestShow({
      id: SHOW_PAST,
      userId: USER_A,
      venueId: VENUE_WITH_SHOWS,
      kind: 'concert',
      state: 'past',
      date: '2023-05-10',
    });
    await createTestShow({
      id: SHOW_FUTURE,
      userId: USER_A,
      venueId: VENUE_WITH_SHOWS,
      kind: 'concert',
      state: 'ticketed',
      date: '2099-06-15',
    });
    await createTestShow({
      id: fakeUuid(PREFIX, 'sdetail'),
      userId: USER_A,
      venueId: VENUE_FOR_DETAIL,
      kind: 'concert',
      state: 'past',
      date: '2024-04-01',
    });

    // USER_A follows VENUE_FOLLOWED_ONLY directly (no shows).
    await db
      .insert(userVenueFollows)
      .values({ userId: USER_A, venueId: VENUE_FOLLOWED_ONLY })
      .onConflictDoNothing();

    // Pre-set follow on VENUE_FOR_UNFOLLOW for USER_A to test unfollow.
    await db
      .insert(userVenueFollows)
      .values({ userId: USER_A, venueId: VENUE_FOR_UNFOLLOW })
      .onConflictDoNothing();

    // Announcement seeds for upcomingAnnouncements + detail.upcomingCount.
    await db.insert(announcements).values([
      {
        id: ANN_UPCOMING,
        venueId: VENUE_FOR_DETAIL,
        kind: 'concert',
        headliner: `${PREFIX} Future Headliner`,
        showDate: '2099-12-31',
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
      },
      {
        id: ANN_PAST,
        venueId: VENUE_FOR_DETAIL,
        kind: 'concert',
        headliner: `${PREFIX} Past Headliner`,
        showDate: '2020-01-01',
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
      },
    ]).onConflictDoNothing();
  });

  after(async () => {
    globalThis.fetch = __originalFetch;
    await preCleanup();
    await cleanupByPrefix(PREFIX);
  });

  describe('list', () => {
    it('returns venues for the user with isFollowed flag and counts', async () => {
      const list = await callerFor(USER_A).venues.list();
      const ids = list.map((r) => r.id);
      assert.ok(ids.includes(VENUE_WITH_SHOWS));
      // Followed-only venue (no shows) should NOT appear in list — list is
      // keyed off shows.venueId.
      assert.equal(ids.includes(VENUE_FOLLOWED_ONLY), false);
      const v = list.find((r) => r.id === VENUE_WITH_SHOWS);
      assert.ok(v);
      assert.equal(v!.isFollowed, false);
      assert.ok((v!.pastShowsCount ?? 0) >= 1);
      assert.ok((v!.futureShowsCount ?? 0) >= 1);
    });

    it('returns empty for a user with no shows', async () => {
      const u = `${PREFIX}-empty`;
      await createTestUser(u);
      const list = await callerFor(u).venues.list();
      const ours = list.filter((v) => v.id.startsWith(PREFIX));
      assert.equal(ours.length, 0);
    });
  });

  describe('count', () => {
    it('returns distinct venue count for the caller', async () => {
      const c = await callerFor(USER_A).venues.count();
      assert.ok(typeof c === 'number');
      assert.ok(c >= 2); // VENUE_WITH_SHOWS + VENUE_FOR_DETAIL
    });

    it('returns 0 for user with no shows', async () => {
      const c = await callerFor(USER_B).venues.count();
      assert.equal(c, 0);
    });
  });

  describe('search', () => {
    it('matches by name ILIKE', async () => {
      const matches = await callerFor(USER_A).venues.search({ query: 'SearchUniqueXyz' });
      assert.ok(matches.some((v) => v.id === VENUE_SEARCH));
    });

    it('returns empty array when query matches nothing', async () => {
      const matches = await callerFor(USER_A).venues.search({
        query: 'NoSuchVenueZZZ987',
      });
      const ours = matches.filter((v) => v.id.startsWith(PREFIX));
      assert.equal(ours.length, 0);
    });
  });

  describe('detail', () => {
    it('returns venue with isFollowed/userShowCount/upcomingCount', async () => {
      const detail = await callerFor(USER_A).venues.detail({ venueId: VENUE_FOR_DETAIL });
      assert.equal(detail.id, VENUE_FOR_DETAIL);
      assert.equal(detail.isFollowed, false);
      assert.ok(Number(detail.userShowCount) >= 1);
      assert.ok(Number(detail.upcomingCount) >= 1);
    });

    it('throws NOT_FOUND for unknown venue', async () => {
      await assert.rejects(
        () =>
          callerFor(USER_A).venues.detail({
            venueId: '00000000-0000-0000-0000-000000000000',
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });
  });

  describe('followed', () => {
    it('returns the venues the caller follows', async () => {
      const list = await callerFor(USER_A).venues.followed();
      const ids = list.map((v) => v.id);
      assert.ok(ids.includes(VENUE_FOLLOWED_ONLY));
    });

    it('returns empty for a user who follows nothing', async () => {
      const list = await callerFor(USER_B).venues.followed();
      const ours = list.filter((v) => v.id.startsWith(PREFIX));
      assert.equal(ours.length, 0);
    });
  });

  describe('follow', () => {
    it('inserts a follow row and is idempotent', async () => {
      const res1 = await callerFor(USER_B).venues.follow({ venueId: VENUE_FOR_FOLLOW });
      assert.equal(res1.success, true);
      const res2 = await callerFor(USER_B).venues.follow({ venueId: VENUE_FOR_FOLLOW });
      assert.equal(res2.success, true);
      const rows = await db
        .select()
        .from(userVenueFollows)
        .where(
          and(
            eq(userVenueFollows.userId, USER_B),
            eq(userVenueFollows.venueId, VENUE_FOR_FOLLOW),
          ),
        );
      assert.equal(rows.length, 1);
    });
  });

  describe('unfollow', () => {
    it('removes the follow row and reports deleted=false when venue stays', async () => {
      // VENUE_FOR_UNFOLLOW has coords + at least one announcement-less venue
      // → the cleanup_orphaned_venue trigger drops the venue when its
      // shows + announcements are gone. We need a venue that has at least
      // one user show OR an announcement to keep `deleted: false`. Add a
      // sticky show so the trigger doesn't drop the venue.
      await createTestShow({
        id: fakeUuid(PREFIX, 'sufkeep'),
        userId: USER_A,
        venueId: VENUE_FOR_UNFOLLOW,
        kind: 'concert',
        state: 'past',
        date: '2024-01-01',
      });

      const res = await callerFor(USER_A).venues.unfollow({ venueId: VENUE_FOR_UNFOLLOW });
      assert.equal(res.success, true);
      assert.equal(res.deleted, false);
      const rows = await db
        .select()
        .from(userVenueFollows)
        .where(
          and(
            eq(userVenueFollows.userId, USER_A),
            eq(userVenueFollows.venueId, VENUE_FOR_UNFOLLOW),
          ),
        );
      assert.equal(rows.length, 0);
    });

    it('unfollow is idempotent (no error if not previously followed)', async () => {
      const res = await callerFor(USER_B).venues.unfollow({ venueId: VENUE_FOR_UNFOLLOW });
      assert.equal(res.success, true);
    });
  });

  describe('rename', () => {
    it('rename allowed when caller follows the venue (and trims input)', async () => {
      // USER_A follows VENUE_FOLLOWED_ONLY.
      const updated = await callerFor(USER_A).venues.rename({
        venueId: VENUE_FOLLOWED_ONLY,
        name: '  cc222222 NewName Trimmed  ',
      });
      assert.equal(updated.name, 'cc222222 NewName Trimmed');
    });

    it('rename allowed when caller has a show at the venue', async () => {
      const updated = await callerFor(USER_A).venues.rename({
        venueId: VENUE_WITH_SHOWS,
        name: 'cc222222 Renamed With Shows',
      });
      assert.equal(updated.name, 'cc222222 Renamed With Shows');
    });

    it('rejects with FORBIDDEN when caller has no follow + no show', async () => {
      await assert.rejects(
        () =>
          callerFor(USER_B).venues.rename({
            venueId: VENUE_UNAUTHORIZED,
            name: 'should not change',
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'FORBIDDEN',
      );
    });
  });

  describe('upcomingAnnouncements', () => {
    it('returns only future-dated announcements for the venue', async () => {
      const list = await callerFor(USER_A).venues.upcomingAnnouncements({
        venueId: VENUE_FOR_DETAIL,
        limit: 50,
      });
      const ids = list.map((a) => a.id);
      assert.ok(ids.includes(ANN_UPCOMING));
      assert.equal(ids.includes(ANN_PAST), false);
    });
  });

  describe('userShows', () => {
    it('returns shows at the venue for the caller', async () => {
      const list = await callerFor(USER_A).venues.userShows({ venueId: VENUE_WITH_SHOWS });
      const ids = list.map((s) => s.id);
      assert.ok(ids.includes(SHOW_PAST) || ids.includes(SHOW_FUTURE));
    });

    it('returns empty for a user with no shows at the venue', async () => {
      const list = await callerFor(USER_B).venues.userShows({ venueId: VENUE_WITH_SHOWS });
      assert.equal(list.length, 0);
    });
  });

  describe('saveScrapeConfig + scrapeStatus', () => {
    it('saves a scrape config and reads it back via scrapeStatus', async () => {
      const venueId = fakeUuid(PREFIX, 'vsc');
      await createTestVenue({ id: venueId, name: `${PREFIX} ScrapeVenue`, city: 'Austin' });
      const res = await callerFor(USER_A).venues.saveScrapeConfig({
        venueId,
        config: { url: 'https://example.com/calendar', frequencyDays: 7 },
      });
      assert.equal(res.success, true);

      const status = await callerFor(USER_A).venues.scrapeStatus({ venueId });
      assert.ok(status.config);
      assert.equal(status.lastRun, null);
    });

    it('clearing the config (config=null) removes it', async () => {
      const venueId = fakeUuid(PREFIX, 'vscclr');
      await createTestVenue({ id: venueId, name: `${PREFIX} ClearVenue`, city: 'Austin' });
      // Save then clear
      await callerFor(USER_A).venues.saveScrapeConfig({
        venueId,
        config: { url: 'https://example.com/x', frequencyDays: 7 },
      });
      const cleared = await callerFor(USER_A).venues.saveScrapeConfig({
        venueId,
        config: null,
      });
      assert.equal(cleared.success, true);
      const status = await callerFor(USER_A).venues.scrapeStatus({ venueId });
      assert.equal(status.config, null);
    });

    it('scrapeStatus throws NOT_FOUND for unknown venue', async () => {
      await assert.rejects(
        () =>
          callerFor(USER_A).venues.scrapeStatus({
            venueId: '00000000-0000-0000-0000-000000000000',
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });
  });
});
