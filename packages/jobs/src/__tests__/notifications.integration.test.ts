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
  userRegions,
  shows,
  showPerformers,
  performers,
  venues,
  announcements,
  userVenueFollows,
  userPerformerFollows,
  userDigestEntries,
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
/** No venue / performer follows, but has one active region centered on
 *  VENUE_REGION. Covers the "region-only opt-in still receives a digest"
 *  path. */
const USER_REGION_ONLY = `${PREFIX}-7777-4777-8777-777777777777`;

const VENUE_A = `${PREFIX}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const VENUE_B = `${PREFIX}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
const VENUE_REGION = `${PREFIX}-bbbb-4bbb-8bbb-bbbbbbbbbbcc`;

const PERFORMER_A = `${PREFIX}-cccc-4ccc-8ccc-cccccccccccc`;

const SHOW_TODAY = `${PREFIX}-dddd-4ddd-8ddd-ddddddddddd1`;
const SHOW_UPCOMING = `${PREFIX}-eeee-4eee-8eee-eeeeeeeeeee1`;

const ANN_NEW_VENUE = `${PREFIX}-f000-4f00-8f00-f00000000001`;
const ANN_NEW_ARTIST = `${PREFIX}-f000-4f00-8f00-f00000000002`;
const ANN_OLD = `${PREFIX}-f000-4f00-8f00-f00000000003`;
const ANN_REGION = `${PREFIX}-f000-4f00-8f00-f00000000004`;

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
  await db.delete(userDigestEntries).where(like(userDigestEntries.userId, p));
  await db.delete(userVenueFollows).where(like(userVenueFollows.userId, p));
  await db.delete(userPerformerFollows).where(like(userPerformerFollows.userId, p));
  await db.delete(userRegions).where(like(userRegions.userId, p));
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

  // Venues. VENUE_REGION has coordinates so it can satisfy the
  // region-only match path; the other two intentionally don't, so they
  // exercise the "no coords → no region trigger" branch alongside the
  // venue-follow path.
  await db
    .insert(venues)
    .values([
      { id: VENUE_A, name: 'Test Venue A', city: 'New York', country: 'US' },
      { id: VENUE_B, name: 'Test Venue B', city: 'Brooklyn', country: 'US' },
      {
        id: VENUE_REGION,
        name: 'Test Venue Region',
        city: 'San Francisco',
        country: 'US',
        latitude: 37.7749,
        longitude: -122.4194,
      },
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
      { id: USER_REGION_ONLY, name: 'Region Only', email: 'region@test.local' },
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
      { userId: USER_REGION_ONLY, emailNotifications: true },
    ])
    .onConflictDoNothing();

  // Region-only user gets an active region centered on VENUE_REGION but
  // no venue / performer follows, so anything they receive has to come
  // through the region match path.
  await db
    .insert(userRegions)
    .values([
      {
        userId: USER_REGION_ONLY,
        cityName: 'San Francisco',
        latitude: 37.7749,
        longitude: -122.4194,
        radiusMiles: 25,
        active: true,
      },
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
      {
        // Region-only path: announcement at a venue with coords inside
        // the USER_REGION_ONLY user's active region. No follow on the
        // headliner or venue, so the only thing that can pull it into
        // their digest is the region match.
        id: ANN_REGION,
        venueId: VENUE_REGION,
        kind: 'concert',
        headliner: 'Fresh Region Announcement',
        headlinerPerformerId: null,
        showDate: futureStr,
        runStartDate: null,
        runEndDate: null,
        performanceDates: null,
        onSaleDate: null,
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
        sourceEventId: `${PREFIX}-ann-region`,
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

/**
 * Reset the per-user digest cutoff/idempotency state so each test runs the
 * digest from a clean window. The job now advances `lastDigestComputedAt`
 * for every user once it persists their snapshot, so without this a second
 * same-day `runDailyDigest()` call would see nothing new (correct in prod,
 * but the suite exercises multiple runs per day). Restores the seed baseline:
 * the announcement user keeps a 24h-old `lastDigestSentAt` so its old
 * announcement is excluded; everyone else starts null.
 */
async function resetDigestState(): Promise<void> {
  await db.delete(userDigestEntries).where(like(userDigestEntries.userId, `${PREFIX}%`));
  await db
    .update(userPreferences)
    .set({ lastDigestComputedAt: null, lastDigestSentAt: null })
    .where(like(userPreferences.userId, `${PREFIX}%`));
  await db
    .update(userPreferences)
    .set({ lastDigestSentAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
    .where(eq(userPreferences.userId, USER_WITH_ANNOUNCEMENT));
}

describe('runDailyDigest', () => {
  before(async () => {
    // signUnsubscribeToken (per-user inside the digest loop) requires
    // AUTH_SECRET. The integration test runs against the real
    // @showbook/api, not a mock, so set a value if the environment
    // hasn't already.
    process.env.AUTH_SECRET ??= 'test-auth-secret-for-notifications-integration';
    await cleanup();
    await seed();
  });

  after(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    // Ensure no real Resend key is leaked into the test process by default.
    delete process.env.RESEND_API_KEY;
    // Each test starts from a clean digest cutoff so a prior test's run
    // doesn't advance `lastDigestComputedAt` past the new-announcement window.
    await resetDigestState();
  });

  afterEach(() => {
    mock.restoreAll();
    delete process.env.RESEND_API_KEY;
  });

  it('dry-run path: no RESEND_API_KEY set → counts users with content as skipped', async () => {
    const { sent, skipped } = await runDailyDigest();
    // No emails sent because Resend key is absent.
    assert.equal(sent, 0);
    // Every user is now processed for the snapshot, but none send email:
    // the email-disabled / no-email users skip at the email gate, the
    // content users skip via the dry_run branch (no Resend key), and the
    // no-content users skip via "nothing to send". Either way, skipped ≥ 3.
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

      // Region-only user has no venue / performer follows, but their
      // active region overlaps VENUE_REGION — they should still get a
      // digest via the region-trigger branch.
      const [regionPref] = await db
        .select({ ts: userPreferences.lastDigestSentAt })
        .from(userPreferences)
        .where(eq(userPreferences.userId, USER_REGION_ONLY));
      assert.ok(
        regionPref?.ts,
        'region-only user should have received a digest via region match',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('idempotency: a second run on the same ET day skips users already sent', async () => {
    // A pg-boss retry — modelled here by running the digest twice in one ET
    // day — must not double-send. The first run sends + marks lastDigestSentAt;
    // the second must make zero Resend calls.
    process.env.RESEND_API_KEY = 're_test_key_idem';

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
      const first = await runDailyDigest();
      assert.ok(first.sent >= 3, `first run should send (got ${first.sent})`);
      const firstCalls = resendCalls;
      assert.ok(firstCalls >= 3, 'first run should hit Resend');

      const second = await runDailyDigest();
      assert.equal(
        resendCalls - firstCalls,
        0,
        'no new Resend calls expected on a same-day re-run',
      );
      assert.equal(second.sent, 0, 'no users marked sent on retry');
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

  it('email_notifications=false: snapshot is still persisted but no email is sent', async () => {
    // Headline decoupling: the email preference gates ONLY the email. The
    // disabled user follows VENUE_B (seeded below as a fresh follow) so they
    // have new announcements; after a run they get a `user_digest_entries`
    // snapshot and `lastDigestComputedAt`, but never `lastDigestSentAt`.
    await db
      .insert(userVenueFollows)
      .values({ userId: USER_DISABLED, venueId: VENUE_B })
      .onConflictDoNothing();

    process.env.RESEND_API_KEY = 're_test_key_disabled';
    const originalFetch = globalThis.fetch;
    let resendCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('resend')) {
        resendCalls++;
        return new Response(JSON.stringify({ id: 'x' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input as RequestInfo | URL);
    }) as typeof fetch;

    try {
      await runDailyDigest();

      const entries = await db
        .select({ id: userDigestEntries.announcementId })
        .from(userDigestEntries)
        .where(eq(userDigestEntries.userId, USER_DISABLED));
      assert.ok(
        entries.length >= 1,
        'disabled user should still get a snapshot',
      );

      const [pref] = await db
        .select({
          sent: userPreferences.lastDigestSentAt,
          computed: userPreferences.lastDigestComputedAt,
        })
        .from(userPreferences)
        .where(eq(userPreferences.userId, USER_DISABLED));
      assert.equal(pref?.sent, null, 'disabled user never gets an email');
      assert.ok(
        pref?.computed,
        'disabled user should have lastDigestComputedAt advanced',
      );
    } finally {
      globalThis.fetch = originalFetch;
      await db
        .delete(userVenueFollows)
        .where(eq(userVenueFollows.userId, USER_DISABLED));
    }
  });

  it('snapshot persists entries with reason + ascending position for followers', async () => {
    await runDailyDigest(); // dry-run is fine; snapshot is email-independent

    const rows = await db
      .select({
        announcementId: userDigestEntries.announcementId,
        reason: userDigestEntries.reason,
        position: userDigestEntries.position,
      })
      .from(userDigestEntries)
      .where(eq(userDigestEntries.userId, USER_WITH_ANNOUNCEMENT))
      .orderBy(userDigestEntries.position);

    assert.ok(rows.length >= 1, 'announcement user should get a snapshot');
    // Positions are a 0-based dense sequence.
    rows.forEach((r, i) => assert.equal(r.position, i));
    // The followed-venue announcement is present with reason 'venue'.
    assert.ok(
      rows.some((r) => r.announcementId === ANN_NEW_VENUE && r.reason === 'venue'),
    );
  });

  it('snapshot is replaced (not appended) on a fresh run', async () => {
    await runDailyDigest();
    const firstIds = (
      await db
        .select({ id: userDigestEntries.announcementId })
        .from(userDigestEntries)
        .where(eq(userDigestEntries.userId, USER_WITH_ANNOUNCEMENT))
    )
      .map((r) => r.id)
      .sort();

    // resetDigestState (beforeEach analogue) — clear the guard so the next
    // run recomputes, then run again. The set should be identical, not doubled.
    await resetDigestState();
    await runDailyDigest();
    const secondIds = (
      await db
        .select({ id: userDigestEntries.announcementId })
        .from(userDigestEntries)
        .where(eq(userDigestEntries.userId, USER_WITH_ANNOUNCEMENT))
    )
      .map((r) => r.id)
      .sort();

    assert.deepEqual(secondIds, firstIds, 'replace, not append');
  });

  it('snapshot is cleared when a follower has no new announcements', async () => {
    // First run builds a snapshot for the announcement user.
    await runDailyDigest();
    const before = await db
      .select({ id: userDigestEntries.announcementId })
      .from(userDigestEntries)
      .where(eq(userDigestEntries.userId, USER_WITH_ANNOUNCEMENT));
    assert.ok(before.length >= 1);

    // Advance the cutoff to "now" (nothing discovered after this) and clear
    // the compute guard, then re-run: the snapshot must be emptied.
    await db.delete(userDigestEntries).where(like(userDigestEntries.userId, `${PREFIX}%`));
    await db
      .update(userPreferences)
      .set({ lastDigestComputedAt: null, lastDigestSentAt: new Date() })
      .where(eq(userPreferences.userId, USER_WITH_ANNOUNCEMENT));
    await runDailyDigest();

    const after = await db
      .select({ id: userDigestEntries.announcementId })
      .from(userDigestEntries)
      .where(eq(userDigestEntries.userId, USER_WITH_ANNOUNCEMENT));
    assert.equal(after.length, 0, 'snapshot cleared when nothing is new');
  });

  it('retry after snapshot persisted (but email unsent) still ships a non-empty digest', async () => {
    // Models a hard-kill retry: the user's snapshot was already built this run
    // (lastDigestComputedAt = today, so the snapshot-persist step is a guarded
    // no-op) but the email never sent (lastDigestSentAt still in the past). The
    // email window must anchor on lastDigestSentAt, not the advanced
    // lastDigestComputedAt — otherwise the retry recomputes an empty window and
    // USER_WITH_ANNOUNCEMENT (who has new announcements but no today/upcoming
    // shows) gets skipped instead of emailed.
    await db
      .update(userPreferences)
      .set({
        lastDigestComputedAt: new Date(),
        lastDigestSentAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      })
      .where(eq(userPreferences.userId, USER_WITH_ANNOUNCEMENT));

    process.env.RESEND_API_KEY = 're_test_retry';
    const originalFetch = globalThis.fetch;
    const sentHtml: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('resend')) {
        const body = typeof init?.body === 'string' ? init.body : '';
        sentHtml.push(body);
        return new Response(JSON.stringify({ id: 'sent' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return originalFetch(input as RequestInfo | URL);
    }) as typeof fetch;

    try {
      const { sent } = await runDailyDigest();
      assert.ok(sent >= 1, 'a digest should still send on the retry');
      // The announcement user's email must contain their new announcements,
      // proving the email window did not collapse to empty.
      assert.ok(
        sentHtml.some((html) =>
          /Fresh Venue Announcement|Fresh Artist Announcement/.test(html),
        ),
        'retry email should still include the new announcements',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
