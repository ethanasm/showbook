/**
 * Integration tests for the Phase 4 cleanup predicate in runDiscoverIngest.
 *
 * Specifically guards the runEndDate-aware prune: a multi-night run with a
 * past `runStartDate` (= `showDate`) but a future `runEndDate` must NOT be
 * deleted, even though its `showDate` is older than the 7-day cutoff.
 *
 * The test seeds rows directly and invokes `runDiscoverIngest`. Phases 1-3
 * iterate over followed venues / regions / performers — with none seeded
 * carrying a Ticketmaster ID, they're no-ops and never touch Ticketmaster,
 * so this stays a pure DB integration test.
 *
 * The fixture seeds a `userVenueFollows` row for the test venue so the
 * `announcement_has_preserver()` SQL function (0023 migration) treats our
 * announcements as preserved. Without it, the parallel test runner can
 * fire `runPruneOrphanCatalog()` from a sibling test file mid-run and
 * nuke our otherwise-orphan announcements concurrently.
 *
 * Run with:
 *   pnpm --filter @showbook/jobs test:integration
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  db,
  announcements,
  users,
  userVenueFollows,
  venues,
  sql,
} from '@showbook/db';
import { eq, like } from 'drizzle-orm';
import { runDiscoverIngest } from '../discover-ingest';

const PREFIX = 'ee117117';

const USER = `${PREFIX}-1111-4111-8111-111111111111`;
const VENUE = `${PREFIX}-aaaa-4aaa-8aaa-aaaaaaaaaaa1`;

const ANN_ONGOING_RUN = `${PREFIX}-f000-4f00-8f00-f00000000001`;
const ANN_FINISHED_RUN = `${PREFIX}-f000-4f00-8f00-f00000000002`;
const ANN_OLD_SINGLE = `${PREFIX}-f000-4f00-8f00-f00000000003`;
const ANN_FUTURE_SINGLE = `${PREFIX}-f000-4f00-8f00-f00000000004`;

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0]!;
}

async function cleanup(): Promise<void> {
  const p = `${PREFIX}%`;
  // user_venue_follows must clear before venues/users so the unfollow
  // trigger doesn't try to chain-delete the venue while announcements
  // still reference it.
  await db.delete(userVenueFollows).where(like(userVenueFollows.userId, p));
  await db.delete(announcements).where(like(sql`${announcements.id}::text`, p));
  await db.delete(venues).where(like(sql`${venues.id}::text`, p));
  await db.delete(users).where(like(users.id, p));
}

describe('runDiscoverIngest Phase 4 prune', () => {
  before(async () => {
    await cleanup();
    await db.insert(users).values([
      { id: USER, name: 'Prune Test User', email: 'prune-test@test.local' },
    ]);
    await db.insert(venues).values([
      { id: VENUE, name: 'Prune Test Venue', city: 'NYC', country: 'US' },
    ]);
    // Anchor announcements via a follow so a concurrent
    // runPruneOrphanCatalog sweep (from a sibling test file) doesn't
    // delete them out from under us. Phase 1 still no-ops because the
    // venue has no Ticketmaster ID.
    await db.insert(userVenueFollows).values([
      { userId: USER, venueId: VENUE },
    ]);

    const past30 = dateOffset(-30);
    const future30 = dateOffset(30);
    const past8 = dateOffset(-8);

    await db.insert(announcements).values([
      // In-progress multi-night run: started 30 days ago, runs 30 days
      // forward. Old code (showDate < cutoff) would delete this row even
      // though performances are still happening. New code preserves it.
      {
        id: ANN_ONGOING_RUN,
        venueId: VENUE,
        kind: 'theatre',
        headliner: 'Ongoing Run',
        productionName: 'Multi-Night Production',
        showDate: past30,
        runStartDate: past30,
        runEndDate: future30,
        performanceDates: [past30, dateOffset(-15), dateOffset(0), future30],
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
        sourceEventId: `${PREFIX}-ongoing`,
      },
      // Finished multi-night run: ended 8 days ago. New code deletes it.
      {
        id: ANN_FINISHED_RUN,
        venueId: VENUE,
        kind: 'theatre',
        headliner: 'Finished Run',
        productionName: 'Past Production',
        showDate: dateOffset(-30),
        runStartDate: dateOffset(-30),
        runEndDate: past8,
        performanceDates: [dateOffset(-30), past8],
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
        sourceEventId: `${PREFIX}-finished`,
      },
      // Old single-night event (no runEndDate, fall back to showDate). Deleted.
      {
        id: ANN_OLD_SINGLE,
        venueId: VENUE,
        kind: 'concert',
        headliner: 'Old Concert',
        showDate: past8,
        runStartDate: null,
        runEndDate: null,
        performanceDates: null,
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
        sourceEventId: `${PREFIX}-old-single`,
      },
      // Future single-night event. Preserved.
      {
        id: ANN_FUTURE_SINGLE,
        venueId: VENUE,
        kind: 'concert',
        headliner: 'Future Concert',
        showDate: future30,
        runStartDate: null,
        runEndDate: null,
        performanceDates: null,
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
        sourceEventId: `${PREFIX}-future-single`,
      },
    ]);
  });

  after(cleanup);

  it('preserves an in-progress multi-night run whose runEndDate is in the future', async () => {
    await runDiscoverIngest();

    const ongoing = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, ANN_ONGOING_RUN));
    assert.equal(
      ongoing.length,
      1,
      'in-progress multi-night run with future runEndDate should survive Phase 4',
    );
  });

  it('deletes a multi-night run whose runEndDate is past the cutoff', async () => {
    const finished = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, ANN_FINISHED_RUN));
    assert.equal(
      finished.length,
      0,
      'multi-night run that ended >7 days ago should be pruned',
    );
  });

  it('deletes an old single-night event (no runEndDate, falls back to showDate)', async () => {
    const old = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, ANN_OLD_SINGLE));
    assert.equal(old.length, 0, 'past single-night event should be pruned');
  });

  it('preserves a future single-night event', async () => {
    const future = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, ANN_FUTURE_SINGLE));
    assert.equal(future.length, 1, 'future single-night event should survive');
  });
});
