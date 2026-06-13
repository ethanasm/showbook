/**
 * discover.followedFeed (Venues tab) must filter out past-dated
 * announcements. Mirrors the past-date guard on followedArtistsFeed —
 * there is no pg-boss job that prunes past announcements, so the
 * discover query is the only thing keeping past dates off-screen.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/followed-feed.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, announcements, userVenueFollows, userVenueNames } from '@showbook/db';
import {
  callerFor,
  cleanupByPrefix,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'aabbf003';
const USER_ID = `${PREFIX}-user`;

const VENUE = fakeUuid(PREFIX, 'venue');
const ANN_FUTURE = fakeUuid(PREFIX, 'fut');
const ANN_PAST = fakeUuid(PREFIX, 'past');

function dateInFuture(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

describe('discover.followedFeed', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER_ID);
    await createTestVenue({ id: VENUE, name: 'Test Hall', city: 'NYC' });

    await db
      .insert(userVenueFollows)
      .values({ userId: USER_ID, venueId: VENUE })
      .onConflictDoNothing();

    await db
      .insert(announcements)
      .values({
        id: ANN_FUTURE,
        venueId: VENUE,
        kind: 'concert',
        headliner: 'Tomorrow Band',
        showDate: dateInFuture(7),
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
      })
      .onConflictDoNothing();

    await db
      .insert(announcements)
      .values({
        id: ANN_PAST,
        venueId: VENUE,
        kind: 'concert',
        headliner: 'Yesterday Band',
        showDate: dateInFuture(-7),
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
      })
      .onConflictDoNothing();
  });

  after(async () => {
    await cleanupByPrefix(PREFIX);
  });

  it('filters out announcements whose showDate is in the past', async () => {
    const result = await callerFor(USER_ID).discover.followedFeed({});
    const ids = result.items.map((i) => i.id).filter((id) => id.startsWith(PREFIX));
    assert.ok(ids.includes(ANN_FUTURE), 'future announcement missing');
    assert.ok(!ids.includes(ANN_PAST), 'past-dated announcement leaked into Discover');
  });

  it('resolves the user venue-name alias onto feed rows', async () => {
    // Without an alias the canonical name flows through unchanged.
    const before = await callerFor(USER_ID).discover.followedFeed({});
    const beforeRow = before.items.find((i) => i.id === ANN_FUTURE);
    assert.equal(beforeRow?.venue.name, 'Test Hall');

    await db
      .insert(userVenueNames)
      .values({ userId: USER_ID, venueId: VENUE, customName: 'My Local Hall' })
      .onConflictDoUpdate({
        target: [userVenueNames.userId, userVenueNames.venueId],
        set: { customName: 'My Local Hall' },
      });

    const after = await callerFor(USER_ID).discover.followedFeed({});
    const afterRow = after.items.find((i) => i.id === ANN_FUTURE);
    assert.equal(
      afterRow?.venue.name,
      'My Local Hall',
      'followedFeed should surface the per-user venue alias',
    );
  });
});
