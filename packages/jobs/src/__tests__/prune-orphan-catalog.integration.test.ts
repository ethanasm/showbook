/**
 * Integration tests for runPruneOrphanCatalog and the 0025 venue-cleanup-
 * after-unfollow trigger.
 *
 * Covers:
 *  - User-delete cascade prunes venues that were only followed (not
 *    referenced by any show), via the new 0025 trigger.
 *  - Periodic prune sweep removes orphan venues / performers /
 *    announcements that bypassed triggers.
 *  - Preservation: rows still referenced (followed venue, show with
 *    performer, announcement linked to a show, announcement inside an
 *    active region bbox) are kept.
 *
 * Run with:
 *   pnpm --filter @showbook/jobs test:integration
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  db,
  users,
  shows,
  showPerformers,
  performers,
  venues,
  announcements,
  userVenueFollows,
  userPerformerFollows,
  userRegions,
  showAnnouncementLinks,
  sql,
} from '@showbook/db';
import { like, eq } from 'drizzle-orm';
import { runPruneOrphanCatalog } from '../prune-orphan-catalog';

const PREFIX = 'ee025025';

const USER_A = `${PREFIX}-1111-4111-8111-111111111111`;
const USER_B = `${PREFIX}-2222-4222-8222-222222222222`;

const VENUE_FOLLOWED_ONLY = `${PREFIX}-aaaa-4aaa-8aaa-aaaaaaaaaaa1`;
const VENUE_WITH_SHOW = `${PREFIX}-aaaa-4aaa-8aaa-aaaaaaaaaaa2`;
const VENUE_ORPHAN = `${PREFIX}-aaaa-4aaa-8aaa-aaaaaaaaaaa3`;
const VENUE_IN_REGION = `${PREFIX}-aaaa-4aaa-8aaa-aaaaaaaaaaa4`;

const PERFORMER_FOLLOWED = `${PREFIX}-cccc-4ccc-8ccc-cccccccccc01`;
const PERFORMER_ORPHAN = `${PREFIX}-cccc-4ccc-8ccc-cccccccccc02`;
const PERFORMER_IN_SHOW = `${PREFIX}-cccc-4ccc-8ccc-cccccccccc03`;

const SHOW_X = `${PREFIX}-dddd-4ddd-8ddd-dddddddddd01`;

const ANN_LINKED = `${PREFIX}-f000-4f00-8f00-f00000000001`;
const ANN_REGION = `${PREFIX}-f000-4f00-8f00-f00000000002`;
const ANN_ORPHAN = `${PREFIX}-f000-4f00-8f00-f00000000003`;

const REGION_NYC = `${PREFIX}-eeee-4eee-8eee-eeeeeeeeeee1`;

async function cleanup(): Promise<void> {
  const p = `${PREFIX}%`;
  // Disable triggers while wiping so we don't accidentally chain-delete
  // sibling fixtures across tests.
  await db.execute(sql`DELETE FROM show_announcement_links WHERE show_id::text LIKE ${p} OR announcement_id::text LIKE ${p}`);
  await db.execute(sql`DELETE FROM show_performers WHERE show_id::text LIKE ${p}`);
  await db.delete(userVenueFollows).where(like(userVenueFollows.userId, p));
  await db.delete(userPerformerFollows).where(like(userPerformerFollows.userId, p));
  await db.delete(userRegions).where(like(userRegions.userId, p));
  await db.delete(announcements).where(like(sql`${announcements.id}::text`, p));
  await db.delete(shows).where(like(sql`${shows.id}::text`, p));
  await db.delete(performers).where(like(sql`${performers.id}::text`, p));
  await db.delete(venues).where(like(sql`${venues.id}::text`, p));
  await db.delete(users).where(like(users.id, p));
}

describe('0025 venue cleanup after unfollow', () => {
  before(cleanup);
  after(cleanup);
  beforeEach(cleanup);

  it('drops a venue that was only followed once the last follower is gone', async () => {
    await db.insert(users).values([
      { id: USER_A, name: 'A', email: 'a@test.local' },
    ]);
    await db.insert(venues).values([
      { id: VENUE_FOLLOWED_ONLY, name: 'Followed Only', city: 'NYC', country: 'US' },
    ]);
    await db.insert(userVenueFollows).values([
      { userId: USER_A, venueId: VENUE_FOLLOWED_ONLY },
    ]);

    // Sanity: venue exists.
    const before = await db.select().from(venues).where(eq(venues.id, VENUE_FOLLOWED_ONLY));
    assert.equal(before.length, 1);

    // Delete the user — cascade clears user_venue_follows, the 0025
    // trigger should delete the orphan venue.
    await db.delete(users).where(eq(users.id, USER_A));

    const after = await db.select().from(venues).where(eq(venues.id, VENUE_FOLLOWED_ONLY));
    assert.equal(after.length, 0, 'orphan venue should be pruned');
  });

  it('keeps a venue that another user still follows', async () => {
    await db.insert(users).values([
      { id: USER_A, name: 'A', email: 'a@test.local' },
      { id: USER_B, name: 'B', email: 'b@test.local' },
    ]);
    await db.insert(venues).values([
      { id: VENUE_FOLLOWED_ONLY, name: 'Shared', city: 'NYC', country: 'US' },
    ]);
    await db.insert(userVenueFollows).values([
      { userId: USER_A, venueId: VENUE_FOLLOWED_ONLY },
      { userId: USER_B, venueId: VENUE_FOLLOWED_ONLY },
    ]);

    await db.delete(users).where(eq(users.id, USER_A));

    const after = await db.select().from(venues).where(eq(venues.id, VENUE_FOLLOWED_ONLY));
    assert.equal(after.length, 1, 'venue with remaining follower stays');
  });

  it('keeps a venue that has a show even if no one follows it', async () => {
    await db.insert(users).values([
      { id: USER_A, name: 'A', email: 'a@test.local' },
    ]);
    await db.insert(venues).values([
      { id: VENUE_WITH_SHOW, name: 'Has Show', city: 'NYC', country: 'US' },
    ]);
    await db.insert(shows).values([
      {
        id: SHOW_X,
        userId: USER_A,
        venueId: VENUE_WITH_SHOW,
        kind: 'concert',
        state: 'ticketed',
        date: '2030-01-01',
      },
    ]);
    await db.insert(userVenueFollows).values([
      { userId: USER_A, venueId: VENUE_WITH_SHOW },
    ]);

    // Drop the follow alone — 0025 trigger fires but venue has a show.
    await db.delete(userVenueFollows).where(eq(userVenueFollows.userId, USER_A));

    const after = await db.select().from(venues).where(eq(venues.id, VENUE_WITH_SHOW));
    assert.equal(after.length, 1, 'venue with a show survives unfollow');
  });
});

describe('runPruneOrphanCatalog', () => {
  before(cleanup);
  after(cleanup);
  beforeEach(cleanup);

  it('removes a standalone orphan venue (no shows / follows / announcements)', async () => {
    // No FKs touch this row, so no trigger fires on INSERT. Only the
    // periodic sweep can reach it.
    await db.insert(venues).values([
      { id: VENUE_ORPHAN, name: 'Orphan Venue', city: 'NYC', country: 'US' },
    ]);

    const result = await runPruneOrphanCatalog();

    assert.ok(result.venues >= 1, 'venues sweep removed at least the seeded row');
    const ven = await db.select().from(venues).where(eq(venues.id, VENUE_ORPHAN));
    assert.equal(ven.length, 0);
  });

  it('removes a standalone orphan performer (no shows / follows / announcements)', async () => {
    await db.insert(performers).values([
      { id: PERFORMER_ORPHAN, name: 'Orphan Performer' },
    ]);

    const result = await runPruneOrphanCatalog();

    assert.ok(result.performers >= 1, 'performers sweep removed at least the seeded row');
    const perf = await db.select().from(performers).where(eq(performers.id, PERFORMER_ORPHAN));
    assert.equal(perf.length, 0);
  });

  it('removes an orphan announcement and chains to its venue + headliner performer', async () => {
    await db.insert(venues).values([
      { id: VENUE_ORPHAN, name: 'Orphan Venue', city: 'NYC', country: 'US' },
    ]);
    await db.insert(performers).values([
      { id: PERFORMER_ORPHAN, name: 'Orphan Performer' },
    ]);
    await db.insert(announcements).values([
      {
        id: ANN_ORPHAN,
        venueId: VENUE_ORPHAN,
        kind: 'concert',
        headliner: 'Nobody Listening',
        headlinerPerformerId: PERFORMER_ORPHAN,
        showDate: '2030-06-01',
        onSaleStatus: 'announced',
        source: 'ticketmaster',
        sourceEventId: `${PREFIX}-orphan`,
      },
    ]);

    const result = await runPruneOrphanCatalog();

    assert.ok(result.announcements >= 1, 'announcements sweep removed at least the seeded row');
    // Venue + performer deletion happens via the existing 0008 / 0014
    // post-announcement-delete triggers, not the venue/performer sweeps,
    // so we don't assert on result.venues / result.performers here.
    const ann = await db.select().from(announcements).where(eq(announcements.id, ANN_ORPHAN));
    const ven = await db.select().from(venues).where(eq(venues.id, VENUE_ORPHAN));
    const perf = await db.select().from(performers).where(eq(performers.id, PERFORMER_ORPHAN));
    assert.equal(ann.length, 0);
    assert.equal(ven.length, 0);
    assert.equal(perf.length, 0);
  });

  it('preserves announcements linked to a show, performers in show_performers, and venues with active follows', async () => {
    await db.insert(users).values([
      { id: USER_A, name: 'A', email: 'a@test.local' },
    ]);
    await db.insert(venues).values([
      { id: VENUE_WITH_SHOW, name: 'Show Venue', city: 'NYC', country: 'US' },
      { id: VENUE_FOLLOWED_ONLY, name: 'Followed Venue', city: 'NYC', country: 'US' },
    ]);
    await db.insert(performers).values([
      { id: PERFORMER_IN_SHOW, name: 'Show Performer' },
      { id: PERFORMER_FOLLOWED, name: 'Followed Performer' },
    ]);
    await db.insert(shows).values([
      {
        id: SHOW_X,
        userId: USER_A,
        venueId: VENUE_WITH_SHOW,
        kind: 'concert',
        state: 'ticketed',
        date: '2030-01-01',
      },
    ]);
    await db.insert(showPerformers).values([
      { showId: SHOW_X, performerId: PERFORMER_IN_SHOW, role: 'headliner', sortOrder: 0 },
    ]);
    await db.insert(userVenueFollows).values([
      { userId: USER_A, venueId: VENUE_FOLLOWED_ONLY },
    ]);
    await db.insert(userPerformerFollows).values([
      { userId: USER_A, performerId: PERFORMER_FOLLOWED },
    ]);
    await db.insert(announcements).values([
      {
        id: ANN_LINKED,
        venueId: VENUE_WITH_SHOW,
        kind: 'concert',
        headliner: 'Linked',
        showDate: '2030-06-01',
        onSaleStatus: 'announced',
        source: 'ticketmaster',
        sourceEventId: `${PREFIX}-linked`,
      },
    ]);
    await db.insert(showAnnouncementLinks).values([
      { showId: SHOW_X, announcementId: ANN_LINKED },
    ]);

    await runPruneOrphanCatalog();

    const ann = await db.select().from(announcements).where(eq(announcements.id, ANN_LINKED));
    const venWithShow = await db.select().from(venues).where(eq(venues.id, VENUE_WITH_SHOW));
    const venFollowed = await db.select().from(venues).where(eq(venues.id, VENUE_FOLLOWED_ONLY));
    const perfShow = await db.select().from(performers).where(eq(performers.id, PERFORMER_IN_SHOW));
    const perfFollowed = await db.select().from(performers).where(eq(performers.id, PERFORMER_FOLLOWED));
    assert.equal(ann.length, 1, 'show-linked announcement preserved');
    assert.equal(venWithShow.length, 1, 'show venue preserved');
    assert.equal(venFollowed.length, 1, 'followed venue preserved');
    assert.equal(perfShow.length, 1, 'show_performers performer preserved');
    assert.equal(perfFollowed.length, 1, 'followed performer preserved');
  });

  it('preserves an announcement inside an active region bbox', async () => {
    await db.insert(users).values([
      { id: USER_A, name: 'A', email: 'a@test.local' },
    ]);
    // NYC region, 25 miles. Venue placed at NYC coordinates.
    await db.insert(userRegions).values([
      {
        id: REGION_NYC,
        userId: USER_A,
        cityName: 'New York',
        latitude: 40.7128,
        longitude: -74.006,
        radiusMiles: 25,
        active: true,
      },
    ]);
    await db.insert(venues).values([
      {
        id: VENUE_IN_REGION,
        name: 'NYC Venue',
        city: 'NYC',
        country: 'US',
        latitude: 40.72,
        longitude: -74.0,
      },
    ]);
    await db.insert(announcements).values([
      {
        id: ANN_REGION,
        venueId: VENUE_IN_REGION,
        kind: 'concert',
        headliner: 'In Region',
        showDate: '2030-06-01',
        onSaleStatus: 'announced',
        source: 'ticketmaster',
        sourceEventId: `${PREFIX}-region`,
      },
    ]);

    await runPruneOrphanCatalog();

    const ann = await db.select().from(announcements).where(eq(announcements.id, ANN_REGION));
    const ven = await db.select().from(venues).where(eq(venues.id, VENUE_IN_REGION));
    assert.equal(ann.length, 1, 'region-bbox announcement preserved');
    assert.equal(ven.length, 1, 'venue under region preserved');
  });
});
