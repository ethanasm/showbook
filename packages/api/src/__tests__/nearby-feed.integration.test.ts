/**
 * Verifies discover.nearbyFeed's single-UNION rewrite (commit cb5bde0):
 *
 * - Overlapping regions: every announcement still appears, assigned to its
 *   smallest-radius region (no double-emit, no edge-drop where a larger
 *   region's per-region cap was previously consumed by rows that would be
 *   reassigned).
 * - Per-region cursor pagination: the (perRegionLimit+1)th row that lands
 *   in a region becomes its nextCursor.
 * - Followed venues are filtered out of the feed.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/nearby-feed.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, announcements, userRegions, venues } from '@showbook/db';
import { eq } from 'drizzle-orm';
import {
  callerFor,
  cleanupByPrefix,
  createTestUser,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'aabbf001';
const USER_ID = `${PREFIX}-user`;
// NYC center, with two regions: a tight 5mi NYC region and a wide
// 200mi Northeast region centered on NYC. They overlap; the inner
// region is smaller so it should claim shared venues.
const NYC = { lat: 40.7128, lng: -74.006 };

async function seedRegion(id: string, radiusMiles: number, name: string) {
  await db
    .insert(userRegions)
    .values({
      id,
      userId: USER_ID,
      cityName: name,
      latitude: NYC.lat,
      longitude: NYC.lng,
      radiusMiles,
      active: true,
    })
    .onConflictDoNothing();
}

async function seedVenue(id: string, name: string, lat: number, lng: number) {
  await db
    .insert(venues)
    .values({
      id,
      name,
      city: 'NYC',
      country: 'US',
      latitude: lat,
      longitude: lng,
    })
    .onConflictDoNothing();
}

async function seedAnnouncement(opts: {
  id: string;
  venueId: string;
  headliner: string;
  showDate: string;
}) {
  await db
    .insert(announcements)
    .values({
      id: opts.id,
      venueId: opts.venueId,
      kind: 'concert',
      headliner: opts.headliner,
      showDate: opts.showDate,
      onSaleStatus: 'on_sale',
      source: 'ticketmaster',
    })
    .onConflictDoNothing();
}

const SMALL_REGION = fakeUuid(PREFIX, 'sm');
const BIG_REGION = fakeUuid(PREFIX, 'bg');

const VENUE_INNER = fakeUuid(PREFIX, 'vi');
const VENUE_INNER_2 = fakeUuid(PREFIX, 'v2');
const VENUE_OUTER = fakeUuid(PREFIX, 'vo'); // outside small bbox, inside big

const ANN_INNER = fakeUuid(PREFIX, 'ai');
const ANN_INNER_2 = fakeUuid(PREFIX, 'a2');
const ANN_OUTER = fakeUuid(PREFIX, 'ao');

function dateInFuture(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

describe('discover.nearbyFeed', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER_ID);
    await seedRegion(SMALL_REGION, 5, 'NYC tight');
    await seedRegion(BIG_REGION, 200, 'Northeast');

    // Inner venues: inside both bboxes (5mi & 200mi).
    await seedVenue(VENUE_INNER, 'Inner Hall', NYC.lat, NYC.lng);
    await seedVenue(VENUE_INNER_2, 'Inner Hall 2', NYC.lat + 0.01, NYC.lng);
    // Outer venue: outside 5mi but inside 200mi (~50mi north of NYC).
    await seedVenue(VENUE_OUTER, 'Outer Hall', NYC.lat + 0.7, NYC.lng);

    await seedAnnouncement({
      id: ANN_INNER,
      venueId: VENUE_INNER,
      headliner: 'Inner Band',
      showDate: dateInFuture(7),
    });
    await seedAnnouncement({
      id: ANN_INNER_2,
      venueId: VENUE_INNER_2,
      headliner: 'Inner Band 2',
      showDate: dateInFuture(14),
    });
    await seedAnnouncement({
      id: ANN_OUTER,
      venueId: VENUE_OUTER,
      headliner: 'Outer Band',
      showDate: dateInFuture(10),
    });
  });

  after(async () => {
    await cleanupByPrefix(PREFIX);
  });

  it('returns every announcement exactly once across overlapping regions', async () => {
    const result = await callerFor(USER_ID).discover.nearbyFeed({});
    const ids = result.items.map((i) => i.id);
    const ours = ids.filter((id) => id.startsWith(PREFIX));
    // All three test announcements appear
    assert.equal(ours.length, 3);
    // No duplicates
    assert.equal(new Set(ours).size, ours.length);
  });

  it('assigns inner venues to the smaller-radius region', async () => {
    const result = await callerFor(USER_ID).discover.nearbyFeed({});
    const inner = result.items.find((i) => i.id === ANN_INNER);
    assert.ok(inner);
    assert.equal(inner!.regionId, SMALL_REGION);
    assert.equal(inner!.regionRadiusMiles, 5);
  });

  it('assigns outer venues to the larger region (only that bbox matches)', async () => {
    const result = await callerFor(USER_ID).discover.nearbyFeed({});
    const outer = result.items.find((i) => i.id === ANN_OUTER);
    assert.ok(outer);
    assert.equal(outer!.regionId, BIG_REGION);
    assert.equal(outer!.regionRadiusMiles, 200);
  });

  it('emits a per-region nextCursor when perRegionLimit is exceeded', async () => {
    // Cap small region at 1: it has 2 inner announcements, so it should
    // emit one item and a cursor for the next page.
    const result = await callerFor(USER_ID).discover.nearbyFeed({
      perRegionLimit: 1,
    });
    const innerCount = result.items.filter(
      (i) => i.regionId === SMALL_REGION,
    ).length;
    assert.equal(innerCount, 1);
    assert.ok(
      result.nextCursors[SMALL_REGION],
      'expected SMALL_REGION cursor after hitting perRegionLimit',
    );
    // BIG region only has 1 item assigned — no cursor.
    assert.equal(result.nextCursors[BIG_REGION], undefined);
  });

  it('per-region cursor advances to the next inner announcement on page 2', async () => {
    const page1 = await callerFor(USER_ID).discover.nearbyFeed({
      perRegionLimit: 1,
    });
    const cursor = page1.nextCursors[SMALL_REGION];
    assert.ok(cursor);
    const page2 = await callerFor(USER_ID).discover.nearbyFeed({
      perRegionLimit: 1,
      cursors: { [SMALL_REGION]: cursor! },
    });
    const innerOnPage2 = page2.items.filter(
      (i) => i.regionId === SMALL_REGION,
    );
    assert.equal(innerOnPage2.length, 1);
    // Different inner announcement than page 1
    assert.notEqual(innerOnPage2[0]!.id, page1.items.find((i) => i.regionId === SMALL_REGION)!.id);
  });

  it('returns hasRegions: false when user has no active regions', async () => {
    // Temporarily deactivate both regions
    await db
      .update(userRegions)
      .set({ active: false })
      .where(eq(userRegions.userId, USER_ID));

    const result = await callerFor(USER_ID).discover.nearbyFeed({});
    assert.equal(result.hasRegions, false);
    assert.equal(result.items.length, 0);

    // Reactivate for cleanup symmetry
    await db
      .update(userRegions)
      .set({ active: true })
      .where(eq(userRegions.userId, USER_ID));
  });
});
