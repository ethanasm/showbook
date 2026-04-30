/**
 * Integration tests for the performers tRPC router.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api test:integration
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';

// Install a fake pg-boss BEFORE the router/job-queue module loads, so
// follow/unfollow mutations don't open a real Postgres pool that prevents
// the test process from exiting.
const __globals = globalThis as unknown as {
  __showbookBoss?: { send: () => Promise<string | null>; start: () => Promise<void> };
};
__globals.__showbookBoss = {
  send: async () => 'fake-job-id',
  start: async () => {},
};
import {
  db,
  performers,
  userPerformerFollows,
  showPerformers,
  announcements,
  userVenueFollows,
  userRegions,
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

const PREFIX = 'cc111111';

/**
 * Extra pre-cleanup so the standard cleanupByPrefix doesn't trip the
 * cleanup_orphaned_venue trigger (which fires on announcement delete and
 * tries to delete the venue, blocked by user_venue_follows). Removes any
 * follow rows pointing at our prefixed venues/performers, regardless of
 * which user created them.
 */
async function preCleanup(): Promise<void> {
  const p = `${PREFIX}%`;
  await db.execute(
    sql`DELETE FROM user_venue_follows WHERE venue_id IN (SELECT id FROM venues WHERE id::text LIKE ${p})`,
  );
  await db.execute(
    sql`DELETE FROM user_performer_follows WHERE performer_id IN (SELECT id FROM performers WHERE id::text LIKE ${p})`,
  );
}

const USER_A = `${PREFIX}-user-a`;
const USER_B = `${PREFIX}-user-b`;
const VENUE_ID = fakeUuid(PREFIX, 'venue');
const SHOW_A_CONCERT = fakeUuid(PREFIX, 'showacon');
const SHOW_A_THEATRE = fakeUuid(PREFIX, 'showathr');
const SHOW_B_CONCERT = fakeUuid(PREFIX, 'showbcon');
const PERFORMER_FOLLOWED = fakeUuid(PREFIX, 'pf1');
const PERFORMER_SHOWED = fakeUuid(PREFIX, 'pf2'); // attached only to a show
const PERFORMER_ORPHAN = fakeUuid(PREFIX, 'pf3'); // unrelated to user
const PERFORMER_THEATRE = fakeUuid(PREFIX, 'pft'); // only on theatre show
const PERFORMER_BSEARCH = fakeUuid(PREFIX, 'psrch'); // for search test

async function seedPerformer(id: string, name: string) {
  await db
    .insert(performers)
    .values({ id, name })
    .onConflictDoNothing();
}

async function seedShowPerformer(showId: string, performerId: string) {
  await db
    .insert(showPerformers)
    .values({ showId, performerId, role: 'headliner', sortOrder: 0 })
    .onConflictDoNothing();
}

async function seedFollow(userId: string, performerId: string) {
  await db
    .insert(userPerformerFollows)
    .values({ userId, performerId })
    .onConflictDoNothing();
}

async function seedAnn(opts: {
  id: string;
  venueId: string;
  headliner: string;
  headlinerPerformerId: string | null;
}) {
  await db
    .insert(announcements)
    .values({
      id: opts.id,
      venueId: opts.venueId,
      kind: 'concert',
      headliner: opts.headliner,
      headlinerPerformerId: opts.headlinerPerformerId,
      showDate: '2027-06-01',
      onSaleStatus: 'on_sale',
      source: 'ticketmaster',
    })
    .onConflictDoNothing();
}

describe('performers router', () => {
  before(async () => {
    await preCleanup();
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER_A);
    await createTestUser(USER_B);

    await createTestVenue({
      id: VENUE_ID,
      name: 'Performer Test Venue',
      city: 'NYC',
      latitude: 40.7128,
      longitude: -74.006,
    });

    await createTestShow({
      id: SHOW_A_CONCERT,
      userId: USER_A,
      venueId: VENUE_ID,
      kind: 'concert',
      date: '2024-05-01',
      state: 'past',
    });
    await createTestShow({
      id: SHOW_A_THEATRE,
      userId: USER_A,
      venueId: VENUE_ID,
      kind: 'theatre',
      date: '2024-06-01',
      state: 'past',
    });
    await createTestShow({
      id: SHOW_B_CONCERT,
      userId: USER_B,
      venueId: VENUE_ID,
      kind: 'concert',
      date: '2024-07-01',
      state: 'past',
    });

    await seedPerformer(PERFORMER_FOLLOWED, 'cc111111 Followed Band');
    await seedPerformer(PERFORMER_SHOWED, 'cc111111 Showed Performer');
    await seedPerformer(PERFORMER_ORPHAN, 'cc111111 Orphan Artist');
    await seedPerformer(PERFORMER_THEATRE, 'cc111111 Theatre Cast');
    await seedPerformer(PERFORMER_BSEARCH, 'cc111111 Search Unique XyzZyx');

    // PERFORMER_FOLLOWED — appears in USER_A's concert
    await seedShowPerformer(SHOW_A_CONCERT, PERFORMER_FOLLOWED);
    // PERFORMER_SHOWED — appears only in USER_A's concert
    await seedShowPerformer(SHOW_A_CONCERT, PERFORMER_SHOWED);
    // PERFORMER_THEATRE — appears only on theatre show
    await seedShowPerformer(SHOW_A_THEATRE, PERFORMER_THEATRE);

    // USER_A follows PERFORMER_FOLLOWED.
    await seedFollow(USER_A, PERFORMER_FOLLOWED);
  });

  after(async () => {
    await preCleanup();
    await cleanupByPrefix(PREFIX);
  });

  describe('list', () => {
    it('returns concert performers for the user (excludes theatre)', async () => {
      const list = await callerFor(USER_A).performers.list();
      const ids = list.map((r) => r.id);
      assert.ok(ids.includes(PERFORMER_FOLLOWED));
      assert.ok(ids.includes(PERFORMER_SHOWED));
      // theatre performer should NOT appear in list (router filters ne theatre)
      assert.equal(ids.includes(PERFORMER_THEATRE), false);
      assert.equal(ids.includes(PERFORMER_ORPHAN), false);

      const followed = list.find((r) => r.id === PERFORMER_FOLLOWED);
      assert.equal(followed?.isFollowed, true);
      const notFollowed = list.find((r) => r.id === PERFORMER_SHOWED);
      assert.equal(notFollowed?.isFollowed, false);

      // showCount is 1 for performer attached to one concert show
      assert.equal(Number(notFollowed?.showCount), 1);
    });

    it('returns empty list for a user with no shows', async () => {
      const otherUser = `${PREFIX}-empty`;
      await createTestUser(otherUser);
      const list = await callerFor(otherUser).performers.list();
      const ours = list.filter((r) => r.id.startsWith('cc111111'));
      assert.equal(ours.length, 0);
    });
  });

  describe('count', () => {
    it('returns distinct concert performer count for caller', async () => {
      const count = await callerFor(USER_A).performers.count();
      // Should be at least 2 (FOLLOWED + SHOWED) for our prefix.
      assert.ok(typeof count === 'number');
      assert.ok(count >= 2);
    });

    it('returns 0 for a user with no shows', async () => {
      const otherUser = `${PREFIX}-cnt0`;
      await createTestUser(otherUser);
      const c = await callerFor(otherUser).performers.count();
      assert.equal(c, 0);
    });
  });

  describe('search', () => {
    it('returns matches by ILIKE on name', async () => {
      const results = await callerFor(USER_A).performers.search({
        query: 'XyzZyx',
      });
      const ids = results.map((r) => r.id);
      assert.ok(ids.includes(PERFORMER_BSEARCH));
    });

    it('returns empty array when query matches nothing', async () => {
      const results = await callerFor(USER_A).performers.search({
        query: 'NoSuchPerformerXYZ123abc',
      });
      const ours = results.filter((r) => r.id.startsWith('cc111111'));
      assert.equal(ours.length, 0);
    });

    it('rejects empty query (zod min(1))', async () => {
      await assert.rejects(() =>
        callerFor(USER_A).performers.search({ query: '' }),
      );
    });
  });

  describe('detail', () => {
    it('returns performer with stats and isFollowed flag', async () => {
      const detail = await callerFor(USER_A).performers.detail({
        performerId: PERFORMER_FOLLOWED,
      });
      assert.equal(detail.id, PERFORMER_FOLLOWED);
      assert.equal(detail.isFollowed, true);
      assert.ok(Number(detail.showCount) >= 1);
      assert.ok(detail.firstSeen);
      assert.ok(detail.lastSeen);
    });

    it('returns isFollowed=false for a performer not followed by caller', async () => {
      const detail = await callerFor(USER_A).performers.detail({
        performerId: PERFORMER_SHOWED,
      });
      assert.equal(detail.isFollowed, false);
      assert.ok(Number(detail.showCount) >= 1);
    });

    it('throws NOT_FOUND for unknown performer', async () => {
      await assert.rejects(
        () =>
          callerFor(USER_A).performers.detail({
            performerId: '00000000-0000-0000-0000-000000000000',
          }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });
  });

  describe('userShows', () => {
    it('returns shows that include this performer for the caller', async () => {
      const shows = await callerFor(USER_A).performers.userShows({
        performerId: PERFORMER_FOLLOWED,
      });
      const ids = shows.map((s) => s.id);
      assert.ok(ids.includes(SHOW_A_CONCERT));
    });

    it('returns empty when no shows match', async () => {
      const shows = await callerFor(USER_B).performers.userShows({
        performerId: PERFORMER_FOLLOWED,
      });
      assert.equal(shows.length, 0);
    });
  });

  describe('follow / unfollow', () => {
    it('follow inserts a row for the caller', async () => {
      const followPerformer = fakeUuid(PREFIX, 'pfollowtest');
      await seedPerformer(followPerformer, 'cc111111 Follow Target');
      const res = await callerFor(USER_B).performers.follow({
        performerId: followPerformer,
      });
      assert.equal(res.success, true);
      const rows = await db
        .select()
        .from(userPerformerFollows)
        .where(
          and(
            eq(userPerformerFollows.userId, USER_B),
            eq(userPerformerFollows.performerId, followPerformer),
          ),
        );
      assert.equal(rows.length, 1);
    });

    it('follow is idempotent (onConflictDoNothing)', async () => {
      // follow PERFORMER_FOLLOWED again (already followed by USER_A)
      const res = await callerFor(USER_A).performers.follow({
        performerId: PERFORMER_FOLLOWED,
      });
      assert.equal(res.success, true);
    });

    it('unfollow removes the follow row', async () => {
      const tempPerf = fakeUuid(PREFIX, 'punfoltest');
      await seedPerformer(tempPerf, 'cc111111 Unfollow Target');
      await seedFollow(USER_B, tempPerf);
      const res = await callerFor(USER_B).performers.unfollow({
        performerId: tempPerf,
      });
      assert.equal(res.success, true);
      const rows = await db
        .select()
        .from(userPerformerFollows)
        .where(
          and(
            eq(userPerformerFollows.userId, USER_B),
            eq(userPerformerFollows.performerId, tempPerf),
          ),
        );
      assert.equal(rows.length, 0);
    });

    it('unfollow when performer has no other followers triggers announcement cleanup', async () => {
      // Set up a performer that only USER_B follows, with announcements at
      // dedicated venues (deleted-venue cleanup trigger may remove venues
      // when their announcements are gone).
      const lonePerf = fakeUuid(PREFIX, 'plone');
      const venueRegion = fakeUuid(PREFIX, 'vregion');
      const venueFar = fakeUuid(PREFIX, 'vfar1');
      const annRegion = fakeUuid(PREFIX, 'annreg');
      const annFar = fakeUuid(PREFIX, 'annfar');
      const regionId = fakeUuid(PREFIX, 'region');

      await createTestVenue({
        id: venueRegion,
        name: 'Region Venue',
        city: 'NYC',
        latitude: 40.7128,
        longitude: -74.006,
      });
      await createTestVenue({
        id: venueFar,
        name: 'Far Venue 1',
        city: 'Honolulu',
        latitude: 21.3,
        longitude: -157.85,
      });

      await seedPerformer(lonePerf, 'cc111111 Lone Performer');
      await seedFollow(USER_B, lonePerf);

      await db
        .insert(userRegions)
        .values({
          id: regionId,
          userId: USER_B,
          cityName: 'NYC',
          latitude: 40.7128,
          longitude: -74.006,
          radiusMiles: 25,
          active: true,
        })
        .onConflictDoNothing();

      await seedAnn({
        id: annRegion,
        venueId: venueRegion,
        headliner: 'Lone',
        headlinerPerformerId: lonePerf,
      });
      await seedAnn({
        id: annFar,
        venueId: venueFar,
        headliner: 'Lone',
        headlinerPerformerId: lonePerf,
      });

      await callerFor(USER_B).performers.unfollow({ performerId: lonePerf });

      const remaining = await db
        .select({ id: announcements.id })
        .from(announcements)
        .where(eq(announcements.headlinerPerformerId, lonePerf));
      const ids = remaining.map((r) => r.id);
      // annRegion preserved (covered by region), annFar deleted (no coverage)
      assert.ok(ids.includes(annRegion));
      assert.equal(ids.includes(annFar), false);
    });

    it('unfollow when other followers exist does NOT delete announcements', async () => {
      const sharedPerf = fakeUuid(PREFIX, 'pshared');
      const venueShared = fakeUuid(PREFIX, 'vshared');
      await createTestVenue({
        id: venueShared,
        name: 'Shared Venue',
        city: 'Honolulu',
        latitude: 21.3,
        longitude: -157.85,
      });
      await seedPerformer(sharedPerf, 'cc111111 Shared Performer');
      await seedFollow(USER_A, sharedPerf);
      await seedFollow(USER_B, sharedPerf);

      const annId = fakeUuid(PREFIX, 'annsh');
      await seedAnn({
        id: annId,
        venueId: venueShared,
        headliner: 'Shared',
        headlinerPerformerId: sharedPerf,
      });

      await callerFor(USER_A).performers.unfollow({ performerId: sharedPerf });
      const remaining = await db
        .select({ id: announcements.id })
        .from(announcements)
        .where(eq(announcements.id, annId));
      assert.equal(remaining.length, 1);
    });

    it('unfollow performer keeps announcement when venue is followed by another user', async () => {
      const perf = fakeUuid(PREFIX, 'ppvenue');
      const venuePV = fakeUuid(PREFIX, 'vpvenue');
      await createTestVenue({
        id: venuePV,
        name: 'PVenue Venue',
        city: 'Honolulu',
        latitude: 21.3,
        longitude: -157.85,
      });
      await seedPerformer(perf, 'cc111111 PVenue Performer');
      await seedFollow(USER_A, perf);

      const annId = fakeUuid(PREFIX, 'annvenue');
      await seedAnn({
        id: annId,
        venueId: venuePV,
        headliner: 'PVenue',
        headlinerPerformerId: perf,
      });

      // Make USER_B follow venuePV
      await db
        .insert(userVenueFollows)
        .values({ userId: USER_B, venueId: venuePV })
        .onConflictDoNothing();

      await callerFor(USER_A).performers.unfollow({ performerId: perf });
      const remaining = await db
        .select({ id: announcements.id })
        .from(announcements)
        .where(eq(announcements.id, annId));
      assert.equal(remaining.length, 1);
    });
  });

  describe('rename', () => {
    it('rename works when caller follows the performer', async () => {
      const target = fakeUuid(PREFIX, 'prnf');
      await seedPerformer(target, 'cc111111 Old Name 1');
      await seedFollow(USER_A, target);

      const updated = await callerFor(USER_A).performers.rename({
        performerId: target,
        name: 'cc111111 New Name 1',
      });
      assert.equal(updated.name, 'cc111111 New Name 1');
    });

    it('rename works when caller has the performer on a show (and trims input)', async () => {
      const target = fakeUuid(PREFIX, 'prns');
      await seedPerformer(target, 'cc111111 Old Name 2');
      await seedShowPerformer(SHOW_A_CONCERT, target);

      const updated = await callerFor(USER_A).performers.rename({
        performerId: target,
        name: '  cc111111 Trimmed  ',
      });
      // Router trims input
      assert.equal(updated.name, 'cc111111 Trimmed');
    });

    it('rename rejects with FORBIDDEN when caller has no stake', async () => {
      await assert.rejects(
        () =>
          callerFor(USER_B).performers.rename({
            performerId: PERFORMER_ORPHAN,
            name: 'should not change',
          }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'FORBIDDEN',
      );
    });
  });

  describe('delete', () => {
    it('detaches performer from caller shows and removes follow', async () => {
      const target = fakeUuid(PREFIX, 'pdel');
      await seedPerformer(target, 'cc111111 ToDelete');
      await seedShowPerformer(SHOW_A_CONCERT, target);
      await seedFollow(USER_A, target);

      const res = await callerFor(USER_A).performers.delete({
        performerId: target,
      });
      assert.equal(res.deleted, 1);

      // No show_performers rows linking USER_A's shows
      const links = await db
        .select()
        .from(showPerformers)
        .where(
          and(
            eq(showPerformers.showId, SHOW_A_CONCERT),
            eq(showPerformers.performerId, target),
          ),
        );
      assert.equal(links.length, 0);

      // Follow row gone
      const follows = await db
        .select()
        .from(userPerformerFollows)
        .where(
          and(
            eq(userPerformerFollows.userId, USER_A),
            eq(userPerformerFollows.performerId, target),
          ),
        );
      assert.equal(follows.length, 0);
    });

    it('delete is a no-op when user has no shows or follow for the performer', async () => {
      const otherUser = `${PREFIX}-nouser`;
      await createTestUser(otherUser);
      const res = await callerFor(otherUser).performers.delete({
        performerId: PERFORMER_ORPHAN,
      });
      assert.equal(res.deleted, 1);
    });
  });

  describe('searchExternal', () => {
    it('returns [] when ticketmaster errors are swallowed', async () => {
      // Stub fetch so the underlying ticketmaster client throws — router
      // catches and returns []. Avoids real network and avoids the test
      // hanging on an unstubbed fetch with a long socket timeout.
      const orig = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new Error('network down (test stub)');
      }) as typeof globalThis.fetch;
      try {
        const results = await callerFor(USER_A).performers.searchExternal({
          query: 'unique-query-for-test-cc111111',
        });
        assert.deepEqual(results, []);
      } finally {
        globalThis.fetch = orig;
      }
    });
  });

  describe('followAttraction', () => {
    it('matches existing performer by tmAttractionId, follows, returns id', async () => {
      // Pre-seed a performer with a known TM attraction id so
      // matchOrCreatePerformer dedupes instead of creating new — and so
      // we don't need to stub TM at all.
      const seededId = fakeUuid(PREFIX, 'pfat');
      const tmId = `cc111111-tm-${Date.now()}`;
      await db
        .insert(performers)
        .values({ id: seededId, name: 'cc111111 FA Performer', ticketmasterAttractionId: tmId })
        .onConflictDoNothing();

      const res = await callerFor(USER_B).performers.followAttraction({
        tmAttractionId: tmId,
        name: 'cc111111 FA Performer',
      });
      assert.equal(res.performerId, seededId);

      const rows = await db
        .select()
        .from(userPerformerFollows)
        .where(
          and(
            eq(userPerformerFollows.userId, USER_B),
            eq(userPerformerFollows.performerId, seededId),
          ),
        );
      assert.equal(rows.length, 1);
    });
  });
});
