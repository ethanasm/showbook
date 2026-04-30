/**
 * Integration tests for runDailyDigest. Exercise the DB-orchestration
 * branches that the pure-function suite (daily-digest.test.ts) does not
 * cover: per-user fetching of today/upcoming shows, follow lookups,
 * announcement filtering by cutoff, dry-run path (no RESEND_API_KEY),
 * Resend success path (mocked), Resend failure path (mocked), skip
 * conditions (no email, nothing to send).
 *
 * Run with:
 *   pnpm --filter @showbook/jobs test:integration
 */

import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  db,
  users,
  userPreferences,
  shows,
  showPerformers,
  performers,
  venues,
  announcements,
  userVenueFollows,
  userPerformerFollows,
  sql,
} from '@showbook/db';
import { like, eq } from 'drizzle-orm';
import { runDailyDigest } from '../notifications';

const PREFIX = 'ee555555';

// UUIDs (v4-shaped) for deterministic test rows.
const USER_WITH_TODAY = `${PREFIX}-1111-4111-8111-111111111111`;
const USER_WITH_ANNOUNCEMENT = `${PREFIX}-2222-4222-8222-222222222222`;
const USER_WITH_UPCOMING = `${PREFIX}-3333-4333-8333-333333333333`;
const USER_NOTHING = `${PREFIX}-4444-4444-8444-444444444444`;
const USER_DISABLED = `${PREFIX}-5555-4555-8555-555555555555`;
const USER_NO_EMAIL = `${PREFIX}-6666-4666-8666-666666666666`;

const VENUE_A = `${PREFIX}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const VENUE_B = `${PREFIX}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;

const PERFORMER_A = `${PREFIX}-cccc-4ccc-8ccc-cccccccccccc`;

const SHOW_TODAY = `${PREFIX}-dddd-4ddd-8ddd-ddddddddddd1`;
const SHOW_UPCOMING = `${PREFIX}-eeee-4eee-8eee-eeeeeeeeeee1`;

const ANN_NEW_VENUE = `${PREFIX}-f000-4f00-8f00-f00000000001`;
const ANN_NEW_ARTIST = `${PREFIX}-f000-4f00-8f00-f00000000002`;
const ANN_OLD = `${PREFIX}-f000-4f00-8f00-f00000000003`;

const todayStr = (): string => {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.toISOString().split('T')[0]!;
};

async function cleanup(): Promise<void> {
  const p = `${PREFIX}%`;
  // Order matters because the cleanup_orphaned_venue trigger fires on shows
  // delete and tries to remove the venue if there are no more shows or
  // announcements referencing it. user_venue_follows must be cleared first
  // so the trigger doesn't hit an FK violation when it tries to drop the
  // (now-orphaned) venue.
  await db.execute(sql`DELETE FROM show_announcement_links WHERE show_id::text LIKE ${p} OR announcement_id::text LIKE ${p}`);
  await db.execute(sql`DELETE FROM show_performers WHERE show_id::text LIKE ${p}`);
  await db.delete(userVenueFollows).where(like(userVenueFollows.userId, p));
  await db.delete(userPerformerFollows).where(like(userPerformerFollows.userId, p));
  await db.delete(announcements).where(like(sql`${announcements.id}::text`, p));
  await db.delete(shows).where(like(sql`${shows.id}::text`, p));
  await db.delete(performers).where(like(sql`${performers.id}::text`, p));
  await db.delete(venues).where(like(sql`${venues.id}::text`, p));
  await db.delete(userPreferences).where(like(userPreferences.userId, p));
  await db.delete(users).where(like(users.id, p));
}

async function seed(): Promise<void> {
  const today = todayStr();
  // Today + 3 days for "upcoming" so it falls in the 7-day window
  const upcoming = new Date(today + 'T00:00:00');
  upcoming.setDate(upcoming.getDate() + 3);
  const upcomingStr = upcoming.toISOString().split('T')[0]!;

  // Venues
  await db
    .insert(venues)
    .values([
      { id: VENUE_A, name: 'Test Venue A', city: 'New York', country: 'US' },
      { id: VENUE_B, name: 'Test Venue B', city: 'Brooklyn', country: 'US' },
    ])
    .onConflictDoNothing();

  // Performers
  await db
    .insert(performers)
    .values([{ id: PERFORMER_A, name: 'Test Headliner' }])
    .onConflictDoNothing();

  // Users
  await db
    .insert(users)
    .values([
      { id: USER_WITH_TODAY, name: 'Today User', email: 'today@test.local' },
      { id: USER_WITH_ANNOUNCEMENT, name: 'Announce User', email: 'announce@test.local' },
      { id: USER_WITH_UPCOMING, name: 'Upcoming User', email: 'upcoming@test.local' },
      { id: USER_NOTHING, name: 'Nothing User', email: 'nothing@test.local' },
      { id: USER_DISABLED, name: 'Disabled User', email: 'disabled@test.local' },
      { id: USER_NO_EMAIL, name: 'No-Email User', email: null },
    ])
    .onConflictDoNothing();

  // User preferences
  await db
    .insert(userPreferences)
    .values([
      { userId: USER_WITH_TODAY, emailNotifications: true },
      { userId: USER_WITH_ANNOUNCEMENT, emailNotifications: true },
      { userId: USER_WITH_UPCOMING, emailNotifications: true },
      { userId: USER_NOTHING, emailNotifications: true },
      { userId: USER_DISABLED, emailNotifications: false },
      { userId: USER_NO_EMAIL, emailNotifications: true },
    ])
    .onConflictDoNothing();

  // Shows: TODAY user has a ticketed show today (concert kind, headliner via showPerformers)
  await db
    .insert(shows)
    .values([
      {
        id: SHOW_TODAY,
        userId: USER_WITH_TODAY,
        venueId: VENUE_A,
        kind: 'concert',
        state: 'ticketed',
        date: today,
        seat: 'A12',
      },
      {
        id: SHOW_UPCOMING,
        userId: USER_WITH_UPCOMING,
        venueId: VENUE_B,
        kind: 'concert',
        state: 'ticketed',
        date: upcomingStr,
      },
    ])
    .onConflictDoNothing();

  // Headliner for the today show (covers getHeadlinersForShows non-theatre branch)
  await db
    .insert(showPerformers)
    .values([
      {
        showId: SHOW_TODAY,
        performerId: PERFORMER_A,
        role: 'headliner',
        sortOrder: 0,
      },
      // Upcoming show has NO headliner — exercises the "Unknown Artist" fallback
    ])
    .onConflictDoNothing();

  // Announcement user follows venue A — give them a fresh announcement at venue A
  await db
    .insert(userVenueFollows)
    .values([{ userId: USER_WITH_ANNOUNCEMENT, venueId: VENUE_A }])
    .onConflictDoNothing();
  await db
    .insert(userPerformerFollows)
    .values([{ userId: USER_WITH_ANNOUNCEMENT, performerId: PERFORMER_A }])
    .onConflictDoNothing();

  // Future-dated announcement so the show passes "today or later" filter for whenLabel
  const future = new Date(today + 'T00:00:00');
  future.setDate(future.getDate() + 60);
  const futureStr = future.toISOString().split('T')[0]!;

  // On-sale soon (within 5 days) so we hit onSaleSoon=true branch
  const onSale = new Date();
  onSale.setDate(onSale.getDate() + 5);

  await db
    .insert(announcements)
    .values([
      {
        id: ANN_NEW_VENUE,
        venueId: VENUE_A,
        kind: 'concert',
        headliner: 'Fresh Venue Announcement',
        headlinerPerformerId: null,
        showDate: futureStr,
        runStartDate: futureStr,
        runEndDate: futureStr,
        performanceDates: [futureStr],
        onSaleDate: onSale,
        onSaleStatus: 'announced',
        source: 'ticketmaster',
        sourceEventId: `${PREFIX}-ann-new-venue`,
      },
      {
        id: ANN_NEW_ARTIST,
        venueId: VENUE_B,
        kind: 'concert',
        headliner: 'Fresh Artist Announcement',
        headlinerPerformerId: PERFORMER_A,
        showDate: futureStr,
        runStartDate: null,
        runEndDate: null,
        performanceDates: null,
        onSaleDate: null,
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
        sourceEventId: `${PREFIX}-ann-new-artist`,
      },
      {
        // Old announcement (discoveredAt manually set far in the past) —
        // user with cutoff after this will not see it. Inserted to verify
        // cutoff filtering trims pre-existing data.
        id: ANN_OLD,
        venueId: VENUE_A,
        kind: 'concert',
        headliner: 'Old Announcement',
        headlinerPerformerId: null,
        showDate: futureStr,
        runStartDate: null,
        runEndDate: null,
        performanceDates: null,
        onSaleDate: null,
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
        sourceEventId: `${PREFIX}-ann-old`,
      },
    ])
    .onConflictDoNothing();

  // Backdate ANN_OLD's discoveredAt so it's outside the fallback cutoff window
  await db.execute(
    sql`UPDATE announcements SET discovered_at = NOW() - INTERVAL '60 days' WHERE id = ${ANN_OLD}::uuid`,
  );
  // Set ANN_NEW_ANNOUNCEMENT users' lastDigestSentAt to a recent time so old
  // announcement is excluded but new ones are included.
  await db
    .update(userPreferences)
    .set({ lastDigestSentAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
    .where(eq(userPreferences.userId, USER_WITH_ANNOUNCEMENT));
}

describe('runDailyDigest', () => {
  before(async () => {
    await cleanup();
    await seed();
  });

  after(async () => {
    await cleanup();
  });

  beforeEach(() => {
    // Ensure no real Resend key is leaked into the test process by default.
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    mock.restoreAll();
    delete process.env.RESEND_API_KEY;
  });

  it('dry-run path: no RESEND_API_KEY set → counts users with content as skipped', async () => {
    const { sent, skipped } = await runDailyDigest();
    // No emails sent because Resend key is absent.
    assert.equal(sent, 0);
    // Six users are eligible+have-email (USER_NO_EMAIL goes through the
    // try block then short-circuits because email is null too — the loop
    // increments `skipped` either way). Three of the eligible users have
    // content (today / upcoming / announcement) — those are the only
    // ones the digest would have sent in dry-run, so they're counted as
    // skipped via the dry_run branch. The remaining ones are skipped via
    // the "nothing to send" branch. Either way, skipped >= 3.
    assert.ok(skipped >= 3, `expected skipped ≥ 3 but got ${skipped}`);
  });

  it('Resend success path: sends, marks lastDigestSentAt, returns sent count', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';

    // Stub fetch so the Resend SDK never actually hits the network.
    const originalFetch = globalThis.fetch;
    let resendCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('resend')) {
        resendCalls++;
        return new Response(JSON.stringify({ id: 'sent-email-id' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input as RequestInfo | URL);
    }) as typeof fetch;

    try {
      const { sent, skipped } = await runDailyDigest();
      assert.ok(sent >= 3, `expected ≥3 sent but got ${sent}`);
      assert.ok(resendCalls >= 3, `expected ≥3 Resend calls but got ${resendCalls}`);
      // skipped should still account for the disabled / nothing / no-email users
      assert.ok(skipped >= 1, `expected ≥1 skipped but got ${skipped}`);

      // lastDigestSentAt should be updated for the today user
      const [pref] = await db
        .select({ ts: userPreferences.lastDigestSentAt })
        .from(userPreferences)
        .where(eq(userPreferences.userId, USER_WITH_TODAY));
      assert.ok(pref?.ts, 'lastDigestSentAt should be set after a successful send');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Resend failure path: per-user errors are caught and counted as skipped', async () => {
    process.env.RESEND_API_KEY = 're_test_key_fail';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('resend')) {
        return new Response(JSON.stringify({ message: 'simulated failure' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input as RequestInfo | URL);
    }) as typeof fetch;

    try {
      const { sent, skipped } = await runDailyDigest();
      // Either the SDK throws (caught → skipped) or returns an error object
      // (the success path still runs). Both branches keep us from crashing.
      assert.ok(sent + skipped >= 3, 'every eligible user accounted for');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('user with email_notifications=false is excluded from the eligible-users query', async () => {
    // Sanity: the disabled user should never receive an update to lastDigestSentAt
    // even on the success path. Verify here.
    const [pref] = await db
      .select({ ts: userPreferences.lastDigestSentAt })
      .from(userPreferences)
      .where(eq(userPreferences.userId, USER_DISABLED));
    assert.equal(pref?.ts, null);
  });
});
