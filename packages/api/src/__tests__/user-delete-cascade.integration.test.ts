/**
 * Verifies the cascade behavior added by drizzle migrations 0022
 * (user FK cascades + trigger gaps) and 0023 (announcement orphan
 * cleanup).
 *
 * Deleting a user must:
 *   - Cascade their shows, follows, regions, preferences, and media.
 *   - Trigger orphan cleanup of venues / performers that no other
 *     user references (across shows, announcements, follows, and
 *     media tags).
 *   - Cascade-clean announcements no one else is following or has a
 *     show linked to.
 *   - Preserve venues / performers / announcements still referenced
 *     by another user (follow / region / show link).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupByPrefix,
  createTestUser,
  createTestVenue,
  createTestShow,
  db,
  fakeUuid,
} from './_test-helpers';
import {
  users,
  shows,
  venues,
  performers,
  showPerformers,
  announcements,
  userVenueFollows,
  userPerformerFollows,
  userRegions,
  userPreferences,
} from '@showbook/db';
import { eq, sql } from 'drizzle-orm';

const PREFIX = 'cd220001';
const ALICE = `${PREFIX}-alice`;
const BOB = `${PREFIX}-bob`;
const SHARED_VENUE = fakeUuid(PREFIX, 'sharedvenue');
const ALICE_VENUE = fakeUuid(PREFIX, 'alicevenue');
const FOLLOW_ONLY_VENUE = fakeUuid(PREFIX, 'followvenue');
const ANN_ONLY_VENUE = fakeUuid(PREFIX, 'annvenue');
const ORPHAN_ANN_VENUE = fakeUuid(PREFIX, 'orphanannvenue');
const SHARED_PERFORMER = fakeUuid(PREFIX, 'sharedperf');
const ALICE_PERFORMER = fakeUuid(PREFIX, 'aliceperf');
const FOLLOW_ONLY_PERFORMER = fakeUuid(PREFIX, 'followperf');
const ANN_HEADLINER = fakeUuid(PREFIX, 'annheadliner');
const ORPHAN_ANN_HEADLINER = fakeUuid(PREFIX, 'orphanannheadliner');
const ALICE_SHOW_SHARED = fakeUuid(PREFIX, 'aliceshowshared');
const ALICE_SHOW_ALICE_VENUE = fakeUuid(PREFIX, 'aliceshowalicevenue');
const ALICE_SHOW_ANN_VENUE = fakeUuid(PREFIX, 'aliceshowannvenue');
const BOB_SHOW = fakeUuid(PREFIX, 'bobshow');
const ANN_ID = fakeUuid(PREFIX, 'announcement');
const ORPHAN_ANN_ID = fakeUuid(PREFIX, 'orphanannouncement');

describe('user delete cascade', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);

    await createTestUser(ALICE);
    await createTestUser(BOB);

    await createTestVenue({ id: SHARED_VENUE, name: `${PREFIX} Shared`, city: 'NYC' });
    await createTestVenue({ id: ALICE_VENUE, name: `${PREFIX} Alice Only`, city: 'NYC' });
    await createTestVenue({ id: FOLLOW_ONLY_VENUE, name: `${PREFIX} Follow Only`, city: 'NYC' });
    await createTestVenue({ id: ANN_ONLY_VENUE, name: `${PREFIX} Ann Only`, city: 'NYC' });
    await createTestVenue({ id: ORPHAN_ANN_VENUE, name: `${PREFIX} Orphan Ann`, city: 'NYC' });

    await db
      .insert(performers)
      .values([
        { id: SHARED_PERFORMER, name: `${PREFIX} Shared Performer` },
        { id: ALICE_PERFORMER, name: `${PREFIX} Alice Performer` },
        { id: FOLLOW_ONLY_PERFORMER, name: `${PREFIX} Follow Only Performer` },
        { id: ANN_HEADLINER, name: `${PREFIX} Ann Headliner` },
        { id: ORPHAN_ANN_HEADLINER, name: `${PREFIX} Orphan Ann Headliner` },
      ])
      .onConflictDoNothing();

    // Alice has shows at three venues (shared + alice-only + ann-only).
    await createTestShow({ id: ALICE_SHOW_SHARED, userId: ALICE, venueId: SHARED_VENUE, date: '2024-01-15', state: 'past' });
    await createTestShow({ id: ALICE_SHOW_ALICE_VENUE, userId: ALICE, venueId: ALICE_VENUE, date: '2026-12-31' });
    await createTestShow({ id: ALICE_SHOW_ANN_VENUE, userId: ALICE, venueId: ANN_ONLY_VENUE, date: '2024-03-01', state: 'past' });
    // Bob shares the venue + headliner with Alice's first show.
    await createTestShow({ id: BOB_SHOW, userId: BOB, venueId: SHARED_VENUE, date: '2024-02-15', state: 'past' });

    await db
      .insert(showPerformers)
      .values([
        { showId: ALICE_SHOW_SHARED, performerId: SHARED_PERFORMER, role: 'headliner', sortOrder: 0 },
        { showId: ALICE_SHOW_ALICE_VENUE, performerId: ALICE_PERFORMER, role: 'headliner', sortOrder: 0 },
        { showId: BOB_SHOW, performerId: SHARED_PERFORMER, role: 'headliner', sortOrder: 0 },
      ])
      .onConflictDoNothing();

    // Alice follows a venue and performer that nothing else references.
    await db.insert(userVenueFollows).values({ userId: ALICE, venueId: FOLLOW_ONLY_VENUE }).onConflictDoNothing();
    await db
      .insert(userPerformerFollows)
      .values({ userId: ALICE, performerId: FOLLOW_ONLY_PERFORMER })
      .onConflictDoNothing();

    await db
      .insert(userRegions)
      .values({ userId: ALICE, cityName: 'NYC', latitude: 40.7, longitude: -74, radiusMiles: 25 })
      .onConflictDoNothing();
    await db.insert(userPreferences).values({ userId: ALICE }).onConflictDoNothing();

    // ANN_ID at ANN_ONLY_VENUE: Bob preserves both via venue + headliner
    // follows, so nothing about it should change when Alice goes.
    await db
      .insert(announcements)
      .values({
        id: ANN_ID,
        venueId: ANN_ONLY_VENUE,
        kind: 'concert',
        headliner: 'Preserved Band',
        headlinerPerformerId: ANN_HEADLINER,
        showDate: '2027-01-01',
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
      })
      .onConflictDoNothing();
    await db
      .insert(userVenueFollows)
      .values({ userId: BOB, venueId: ANN_ONLY_VENUE })
      .onConflictDoNothing();
    await db
      .insert(userPerformerFollows)
      .values({ userId: BOB, performerId: ANN_HEADLINER })
      .onConflictDoNothing();

    // ORPHAN_ANN_ID at ORPHAN_ANN_VENUE: nothing else references the
    // venue or headliner. After Alice (the only user of any kind) is
    // gone, the announcement, venue, and headliner must all chain-clean.
    await db
      .insert(announcements)
      .values({
        id: ORPHAN_ANN_ID,
        venueId: ORPHAN_ANN_VENUE,
        kind: 'concert',
        headliner: 'Orphan Band',
        headlinerPerformerId: ORPHAN_ANN_HEADLINER,
        showDate: '2027-04-01',
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
      })
      .onConflictDoNothing();
  });

  after(async () => {
    // The cleanup helper covers prefixed rows; explicit deletes for any
    // we care about that may have already gone via cascade are a no-op.
    await db.delete(shows).where(eq(shows.userId, BOB));
    await db.delete(users).where(eq(users.id, BOB));
    await cleanupByPrefix(PREFIX);
  });

  it('deletes Alice in one statement and cascades her owned rows', async () => {
    const result = await db.delete(users).where(eq(users.id, ALICE));
    // No assertion on rowCount — drizzle's pg result shape varies — just
    // confirm via re-read that the row is gone.
    void result;

    const aliceLeft = await db.select().from(users).where(eq(users.id, ALICE));
    assert.equal(aliceLeft.length, 0);

    const aliceShows = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.userId, ALICE));
    assert.equal(aliceShows.length, 0, 'Alice shows should cascade');

    const aliceVenueFollows = await db
      .select()
      .from(userVenueFollows)
      .where(eq(userVenueFollows.userId, ALICE));
    assert.equal(aliceVenueFollows.length, 0, 'venue follows should cascade');

    const alicePerformerFollows = await db
      .select()
      .from(userPerformerFollows)
      .where(eq(userPerformerFollows.userId, ALICE));
    assert.equal(alicePerformerFollows.length, 0, 'performer follows should cascade');

    const aliceRegions = await db
      .select()
      .from(userRegions)
      .where(eq(userRegions.userId, ALICE));
    assert.equal(aliceRegions.length, 0, 'regions should cascade');

    const alicePrefs = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, ALICE));
    assert.equal(alicePrefs.length, 0, 'preferences should cascade');
  });

  it('preserves venues / performers still referenced by Bob', async () => {
    const sharedVenueRows = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, SHARED_VENUE));
    assert.equal(sharedVenueRows.length, 1, 'shared venue should remain (Bob still has a show there)');

    const sharedPerformerRows = await db
      .select({ id: performers.id })
      .from(performers)
      .where(eq(performers.id, SHARED_PERFORMER));
    assert.equal(sharedPerformerRows.length, 1, 'shared performer should remain (linked to Bob show)');

    const bobShows = await db
      .select({ id: shows.id })
      .from(shows)
      .where(eq(shows.userId, BOB));
    assert.equal(bobShows.length, 1, "Bob's show should be untouched");
  });

  it('orphan-cleans the venue / performer Alice alone referenced via shows', async () => {
    const aliceVenueRows = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, ALICE_VENUE));
    assert.equal(aliceVenueRows.length, 0, 'Alice-only venue should be orphan-cleaned');

    const alicePerformerRows = await db
      .select({ id: performers.id })
      .from(performers)
      .where(eq(performers.id, ALICE_PERFORMER));
    assert.equal(alicePerformerRows.length, 0, 'Alice-only performer should be orphan-cleaned');
  });

  it('orphan-cleans the venue / performer Alice alone referenced via follows', async () => {
    // The new triggers fire when the cascaded follow rows are deleted.
    const followVenueRows = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, FOLLOW_ONLY_VENUE));
    assert.equal(followVenueRows.length, 0, 'follow-only venue should be cleaned via the new trigger');

    const followPerformerRows = await db
      .select({ id: performers.id })
      .from(performers)
      .where(eq(performers.id, FOLLOW_ONLY_PERFORMER));
    assert.equal(followPerformerRows.length, 0, 'follow-only performer should be cleaned');
  });

  it('preserves announcements (and their venue / headliner) when another user has a follow', async () => {
    // ANN_ONLY_VENUE has only Alice's show on the show side, but Bob
    // follows the venue + headliner, so the announcement's preservers
    // survive Alice's delete. Trigger 0023 must NOT remove ANN_ID,
    // and the existing venue / performer triggers must keep their
    // rows alive because the announcement still holds them.
    const annRows = await db
      .select({ id: announcements.id })
      .from(announcements)
      .where(eq(announcements.id, ANN_ID));
    assert.equal(annRows.length, 1, 'announcement preserved by Bob follows must stay');

    const annVenueRows = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, ANN_ONLY_VENUE));
    assert.equal(annVenueRows.length, 1, 'venue with a preserved announcement must stay');

    const annHeadlinerRows = await db
      .select({ id: performers.id })
      .from(performers)
      .where(eq(performers.id, ANN_HEADLINER));
    assert.equal(annHeadlinerRows.length, 1, 'headliner with a preserved announcement must stay');
  });

  it('cascade-cleans orphan announcements with no surviving preserver', async () => {
    // ORPHAN_ANN_ID's venue and headliner are not referenced by any
    // show, follow, region, or other announcement once Alice is gone.
    // The 0023 triggers (specifically the no-coords + no-active-regions
    // path through the user_regions delete) must wipe the announcement,
    // which then chains via the existing venue / performer cleanup
    // triggers to remove ORPHAN_ANN_VENUE and ORPHAN_ANN_HEADLINER.
    const orphanAnnRows = await db
      .select({ id: announcements.id })
      .from(announcements)
      .where(eq(announcements.id, ORPHAN_ANN_ID));
    assert.equal(orphanAnnRows.length, 0, 'orphan announcement must be cleaned');

    const orphanVenueRows = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, ORPHAN_ANN_VENUE));
    assert.equal(orphanVenueRows.length, 0, 'venue held only by the orphan announcement must be cleaned');

    const orphanHeadlinerRows = await db
      .select({ id: performers.id })
      .from(performers)
      .where(eq(performers.id, ORPHAN_ANN_HEADLINER));
    assert.equal(orphanHeadlinerRows.length, 0, 'headliner held only by the orphan announcement must be cleaned');
  });

  it('leaves no dangling rows referencing the deleted user', async () => {
    // Belt-and-suspenders sanity check across every user-owned table.
    const tables = [
      shows,
      userVenueFollows,
      userPerformerFollows,
      userRegions,
      userPreferences,
    ] as const;
    for (const t of tables) {
      const rows = await db.execute(
        sql`SELECT 1 FROM ${t} WHERE user_id = ${ALICE} LIMIT 1`,
      );
      assert.equal(rows.length, 0, `table should have no Alice rows`);
    }
  });
});
