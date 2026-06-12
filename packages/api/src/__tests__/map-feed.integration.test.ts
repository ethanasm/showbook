/**
 * discover.mapFeed unions the three Discover tabs — followed venues,
 * followed artists, and active regions — into one venue-joined projection
 * for the map's "Discoverable" layer. This exercises each branch plus the
 * future-date guard against the real DB.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/map-feed.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  db,
  announcements,
  performers,
  userPerformerFollows,
  userRegions,
  userVenueFollows,
} from '@showbook/db';
import {
  callerFor,
  cleanupByPrefix,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'aabbf0a1';
const USER_ID = `${PREFIX}-user`;
const EMPTY_USER_ID = `${PREFIX}-empt`;

const V_FOLLOWED = fakeUuid(PREFIX, 'vfollowed');
const V_PERFORMER = fakeUuid(PREFIX, 'vperformer');
const V_REGION = fakeUuid(PREFIX, 'vregion');
const V_UNRELATED = fakeUuid(PREFIX, 'vunrelated');

const PERFORMER = fakeUuid(PREFIX, 'performer');
const REGION = fakeUuid(PREFIX, 'region');

const ANN_VENUE = fakeUuid(PREFIX, 'annvenue');
const ANN_PERFORMER = fakeUuid(PREFIX, 'annperformer');
const ANN_SUPPORT = fakeUuid(PREFIX, 'annsupport');
const ANN_REGION = fakeUuid(PREFIX, 'annregion');
const ANN_THEATRE = fakeUuid(PREFIX, 'anntheatre');
const ANN_PAST = fakeUuid(PREFIX, 'annpast');
const ANN_UNRELATED = fakeUuid(PREFIX, 'annunrelated');

function dateInFuture(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

describe('discover.mapFeed', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER_ID);
    await createTestUser(EMPTY_USER_ID);

    // V_FOLLOWED (LA) and V_PERFORMER (Chicago) sit well outside the NYC
    // region below, so each announcement is reached by exactly one branch
    // (venue follow / performer follow / region bbox) — no overlap.
    await createTestVenue({
      id: V_FOLLOWED,
      name: 'Followed Hall',
      city: 'Los Angeles',
      latitude: 34.05,
      longitude: -118.24,
      stateRegion: 'CA',
    });
    await createTestVenue({
      id: V_PERFORMER,
      name: 'Performer Hall',
      city: 'Chicago',
      latitude: 41.88,
      longitude: -87.63,
      stateRegion: 'IL',
    });
    await createTestVenue({
      id: V_REGION,
      name: 'Region Hall',
      city: 'New York',
      latitude: 40.0,
      longitude: -74.0,
      stateRegion: 'NY',
    });
    await createTestVenue({
      id: V_UNRELATED,
      name: 'Unrelated Hall',
      city: 'Miami',
      latitude: 25.76,
      longitude: -80.19,
      stateRegion: 'FL',
    });

    await db
      .insert(performers)
      .values({ id: PERFORMER, name: 'Followed Artist' })
      .onConflictDoNothing();

    await db
      .insert(userVenueFollows)
      .values({ userId: USER_ID, venueId: V_FOLLOWED })
      .onConflictDoNothing();
    await db
      .insert(userPerformerFollows)
      .values({ userId: USER_ID, performerId: PERFORMER })
      .onConflictDoNothing();
    await db
      .insert(userRegions)
      .values({
        id: REGION,
        userId: USER_ID,
        cityName: 'New York',
        latitude: 40.0,
        longitude: -74.0,
        radiusMiles: 25,
        active: true,
      })
      .onConflictDoNothing();

    await db
      .insert(announcements)
      .values([
        {
          id: ANN_VENUE,
          venueId: V_FOLLOWED,
          kind: 'concert',
          headliner: 'Venue Band',
          showDate: dateInFuture(10),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
          ticketUrl: 'https://www.ticketmaster.com/event/test-venue-band',
        },
        {
          id: ANN_PERFORMER,
          venueId: V_PERFORMER,
          kind: 'concert',
          headliner: 'Performer Band',
          headlinerPerformerId: PERFORMER,
          showDate: dateInFuture(12),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
        {
          id: ANN_SUPPORT,
          venueId: V_UNRELATED,
          kind: 'concert',
          headliner: 'Some Headliner',
          supportPerformerIds: [PERFORMER],
          showDate: dateInFuture(14),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
        {
          id: ANN_REGION,
          venueId: V_REGION,
          kind: 'concert',
          headliner: 'Region Band',
          showDate: dateInFuture(8),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
        {
          id: ANN_THEATRE,
          venueId: V_FOLLOWED,
          kind: 'theatre',
          headliner: 'Theatre Cast',
          productionName: 'Hamilton',
          showDate: dateInFuture(20),
          runStartDate: dateInFuture(20),
          runEndDate: dateInFuture(24),
          performanceDates: [
            dateInFuture(20),
            dateInFuture(22),
            dateInFuture(24),
          ],
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
        {
          id: ANN_PAST,
          venueId: V_FOLLOWED,
          kind: 'concert',
          headliner: 'Yesterday Band',
          showDate: dateInFuture(-7),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
        {
          id: ANN_UNRELATED,
          venueId: V_UNRELATED,
          kind: 'concert',
          headliner: 'Nobody Cares',
          showDate: dateInFuture(9),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
      ])
      .onConflictDoNothing();
  });

  after(async () => {
    await cleanupByPrefix(PREFIX);
  });

  it('unions followed venues, followed artists, and active regions', async () => {
    const rows = await callerFor(USER_ID).discover.mapFeed();
    const ids = rows.map((r) => r.id).filter((id) => id.startsWith(PREFIX));
    assert.ok(ids.includes(ANN_VENUE), 'followed-venue announcement missing');
    assert.ok(
      ids.includes(ANN_PERFORMER),
      'followed-artist (headliner) announcement missing',
    );
    assert.ok(
      ids.includes(ANN_SUPPORT),
      'followed-artist (support) announcement missing',
    );
    assert.ok(ids.includes(ANN_REGION), 'in-region announcement missing');
    assert.ok(
      ids.includes(ANN_THEATRE),
      'followed-venue theatre announcement missing',
    );
  });

  it('excludes past-dated and unrelated announcements', async () => {
    const rows = await callerFor(USER_ID).discover.mapFeed();
    const ids = rows.map((r) => r.id);
    assert.ok(!ids.includes(ANN_PAST), 'past-dated announcement leaked in');
    assert.ok(
      !ids.includes(ANN_UNRELATED),
      'unrelated announcement leaked in',
    );
  });

  it('projects announcements into the listForMap row shape', async () => {
    const rows = await callerFor(USER_ID).discover.mapFeed();
    const venueRow = rows.find((r) => r.id === ANN_VENUE);
    assert.ok(venueRow, 'expected the followed-venue announcement');
    assert.equal(venueRow.state, 'discoverable');
    assert.equal(venueRow.seat, null);
    assert.equal(venueRow.pricePaid, null);
    assert.equal(venueRow.ticketCount, 1);
    assert.equal(venueRow.headlinerName, 'Venue Band');
    assert.equal(venueRow.venue?.id, V_FOLLOWED);
    assert.ok(venueRow.venue?.latitude != null, 'venue latitude missing');
  });

  it('carries the announcement-action fields for the map action sheet', async () => {
    const rows = await callerFor(USER_ID).discover.mapFeed();
    const venueRow = rows.find((r) => r.id === ANN_VENUE);
    assert.ok(venueRow, 'expected the followed-venue announcement');
    assert.equal(
      venueRow.ticketUrl,
      'https://www.ticketmaster.com/event/test-venue-band',
    );
    const theatreRow = rows.find((r) => r.id === ANN_THEATRE);
    assert.ok(theatreRow, 'expected the theatre announcement');
    assert.equal(theatreRow.runStartDate, dateInFuture(20));
    assert.equal(theatreRow.runEndDate, dateInFuture(24));
    assert.deepEqual(theatreRow.performanceDates, [
      dateInFuture(20),
      dateInFuture(22),
      dateInFuture(24),
    ]);
  });

  it('uses the production name as the headliner for theatre announcements', async () => {
    const rows = await callerFor(USER_ID).discover.mapFeed();
    const theatreRow = rows.find((r) => r.id === ANN_THEATRE);
    assert.ok(theatreRow, 'expected the theatre announcement');
    assert.equal(theatreRow.headlinerName, 'Hamilton');
  });

  it('returns an empty array for a user with no follows or regions', async () => {
    const rows = await callerFor(EMPTY_USER_ID).discover.mapFeed();
    assert.deepEqual(rows, []);
  });
});
