/**
 * discover.digestFeed (the "New for you" tab) reads the per-user
 * `user_digest_entries` snapshot joined to the live announcement / venue /
 * performer rows, ordered by the stored bucket `position`, tagged with the
 * snapshot `reason` + `onSaleSoon`. It must:
 *   - return rows in `position` order,
 *   - carry `reason` and `onSaleSoon`,
 *   - resolve the per-user venue-name alias,
 *   - drop an entry whose announcement was pruned (inner join), and
 *   - keep an active run whose first night has passed but runEndDate is future.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/digest-feed.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  db,
  announcements,
  userDigestEntries,
  userVenueNames,
} from '@showbook/db';
import { eq } from 'drizzle-orm';
import {
  callerFor,
  cleanupByPrefix,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'aabbf010';
const USER_ID = `${PREFIX}-user`;

const VENUE = fakeUuid(PREFIX, 'venue');
const ANN_VENUE = fakeUuid(PREFIX, 'venann');
const ANN_REGION = fakeUuid(PREFIX, 'regann');
const ANN_PRUNED = fakeUuid(PREFIX, 'pruned');
const ANN_RUN = fakeUuid(PREFIX, 'run');

function dateInFuture(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

describe('discover.digestFeed', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER_ID);
    await createTestVenue({ id: VENUE, name: 'Digest Hall', city: 'NYC' });

    await db
      .insert(announcements)
      .values([
        {
          id: ANN_VENUE,
          venueId: VENUE,
          kind: 'concert',
          headliner: 'Venue Pick',
          showDate: dateInFuture(10),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
        {
          id: ANN_REGION,
          venueId: VENUE,
          kind: 'concert',
          headliner: 'Region Pick',
          showDate: dateInFuture(20),
          onSaleStatus: 'announced',
          source: 'ticketmaster',
        },
        {
          // An ongoing run: first night already passed, runEndDate future.
          id: ANN_RUN,
          venueId: VENUE,
          kind: 'theatre',
          headliner: 'Long Run',
          showDate: dateInFuture(-3),
          runStartDate: dateInFuture(-3),
          runEndDate: dateInFuture(30),
          performanceDates: [dateInFuture(-3), dateInFuture(30)],
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
      ])
      .onConflictDoNothing();

    // ANN_PRUNED is referenced by a snapshot entry but never inserted into
    // announcements — it stands in for an announcement pruned after the
    // snapshot was written, and must be dropped by the inner join.
    await db
      .insert(userDigestEntries)
      .values([
        { userId: USER_ID, announcementId: ANN_VENUE, reason: 'venue', onSaleSoon: true, position: 0 },
        { userId: USER_ID, announcementId: ANN_RUN, reason: 'venue', onSaleSoon: false, position: 1 },
        { userId: USER_ID, announcementId: ANN_REGION, reason: 'region', onSaleSoon: false, position: 2 },
      ])
      .onConflictDoNothing();
  });

  after(async () => {
    await cleanupByPrefix(PREFIX);
  });

  it('returns snapshot rows in position order with reason + onSaleSoon', async () => {
    const result = await callerFor(USER_ID).discover.digestFeed();
    const mine = result.items.filter((i) => i.id.startsWith(PREFIX));

    assert.deepEqual(
      mine.map((i) => i.id),
      [ANN_VENUE, ANN_RUN, ANN_REGION],
      'rows should follow stored position order',
    );
    const venueRow = mine.find((i) => i.id === ANN_VENUE)!;
    assert.equal(venueRow.reason, 'venue');
    assert.equal(venueRow.onSaleSoon, true);
    const regionRow = mine.find((i) => i.id === ANN_REGION)!;
    assert.equal(regionRow.reason, 'region');
    assert.equal(regionRow.onSaleSoon, false);
  });

  it('keeps an active run whose first night has passed', async () => {
    const result = await callerFor(USER_ID).discover.digestFeed();
    const ids = result.items.map((i) => i.id);
    assert.ok(ids.includes(ANN_RUN), 'ongoing run should remain visible');
  });

  it('drops an entry once its announcement is pruned (FK cascade)', async () => {
    // Insert a real announcement + snapshot entry, confirm it shows, then
    // delete the announcement — the ON DELETE cascade removes the entry, so
    // a pruned announcement can never orphan a row and never surfaces.
    await db
      .insert(announcements)
      .values({
        id: ANN_PRUNED,
        venueId: VENUE,
        kind: 'concert',
        headliner: 'Soon Pruned',
        showDate: dateInFuture(40),
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
      })
      .onConflictDoNothing();
    await db
      .insert(userDigestEntries)
      .values({
        userId: USER_ID,
        announcementId: ANN_PRUNED,
        reason: 'venue',
        onSaleSoon: false,
        position: 99,
      })
      .onConflictDoNothing();

    const before = await callerFor(USER_ID).discover.digestFeed();
    assert.ok(
      before.items.some((i) => i.id === ANN_PRUNED),
      'entry should be visible before its announcement is pruned',
    );

    await db.delete(announcements).where(eq(announcements.id, ANN_PRUNED));

    const after = await callerFor(USER_ID).discover.digestFeed();
    assert.ok(
      !after.items.some((i) => i.id === ANN_PRUNED),
      'pruned announcement should not surface',
    );
  });

  it('resolves the per-user venue-name alias onto rows', async () => {
    await db
      .insert(userVenueNames)
      .values({ userId: USER_ID, venueId: VENUE, customName: 'My Digest Hall' })
      .onConflictDoUpdate({
        target: [userVenueNames.userId, userVenueNames.venueId],
        set: { customName: 'My Digest Hall' },
      });

    const result = await callerFor(USER_ID).discover.digestFeed();
    const row = result.items.find((i) => i.id === ANN_VENUE);
    assert.equal(row?.venue.name, 'My Digest Hall');

    await db
      .delete(userVenueNames)
      .where(eq(userVenueNames.userId, USER_ID));
  });
});
