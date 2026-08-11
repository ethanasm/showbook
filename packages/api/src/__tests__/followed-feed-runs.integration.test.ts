/**
 * `discover.followedFeed` must keep an **in-progress multi-night run** visible.
 *
 * `showDate` is a run's FIRST night, so a feed filtered on `showDate >=
 * CURRENT_DATE` alone drops a run the day after it opens — a 90-night Hamilton
 * run showed on night 1 and vanished on night 2 with 88 performances still to
 * come. `discover.digestFeed` already OR-ed in `runEndDate` (see
 * `digest-feed.integration.test.ts`, "keeps an active run whose first night has
 * passed"); the followed-venues feed did not, and the gap only surfaced when a
 * hardcoded E2E fixture date rolled into the past and left two Playwright shards
 * permanently red.
 *
 * This is the cheap regression guard for that: it asserts the ongoing run is
 * served, that a genuinely finished run is still hidden, and that single-night
 * behaviour (nullable `runEndDate` included) is unchanged.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/followed-feed-runs.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, announcements, userVenueFollows } from '@showbook/db';
import {
  callerFor,
  cleanupByPrefix,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'aabbf011';
const USER_ID = `${PREFIX}-user`;

const VENUE = fakeUuid(PREFIX, 'venue');
const ANN_ONGOING_RUN = fakeUuid(PREFIX, 'ongoin');
const ANN_ONGOING_RUN_B = fakeUuid(PREFIX, 'ongonb');
const ANN_FINISHED_RUN = fakeUuid(PREFIX, 'finish');
const ANN_FUTURE_SINGLE = fakeUuid(PREFIX, 'future');
const ANN_PAST_SINGLE = fakeUuid(PREFIX, 'pastsn');

function dateOffset(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('discover.followedFeed — multi-night runs', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER_ID);
    await createTestVenue({ id: VENUE, name: 'Run Hall', city: 'NYC' });

    await db.insert(userVenueFollows).values({ userId: USER_ID, venueId: VENUE }).onConflictDoNothing();

    await db
      .insert(announcements)
      .values([
        {
          // In progress: opened 3 days ago, 87 nights still to come.
          id: ANN_ONGOING_RUN,
          venueId: VENUE,
          kind: 'theatre',
          headliner: 'Ongoing Run',
          productionName: 'Ongoing Run',
          showDate: dateOffset(-3),
          runStartDate: dateOffset(-3),
          runEndDate: dateOffset(87),
          performanceDates: [dateOffset(-3), dateOffset(87)],
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
        {
          // Second in-progress run: opened 5 days ago, 30 nights left.
          // Exists so cursor pagination has more than one clamped row
          // to walk (see the pagination test below).
          id: ANN_ONGOING_RUN_B,
          venueId: VENUE,
          kind: 'theatre',
          headliner: 'Ongoing Run B',
          productionName: 'Ongoing Run B',
          showDate: dateOffset(-5),
          runStartDate: dateOffset(-5),
          runEndDate: dateOffset(30),
          performanceDates: [dateOffset(-5), dateOffset(30)],
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
        {
          // Closed: the whole run is behind us.
          id: ANN_FINISHED_RUN,
          venueId: VENUE,
          kind: 'theatre',
          headliner: 'Finished Run',
          productionName: 'Finished Run',
          showDate: dateOffset(-60),
          runStartDate: dateOffset(-60),
          runEndDate: dateOffset(-10),
          performanceDates: [dateOffset(-60), dateOffset(-10)],
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
        {
          // Single night, future, no runEndDate — the nullable-column path.
          id: ANN_FUTURE_SINGLE,
          venueId: VENUE,
          kind: 'concert',
          headliner: 'Future Single',
          showDate: dateOffset(14),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
        {
          // Single night, past, no runEndDate — must stay hidden. `NULL >=
          // CURRENT_DATE` is NULL and `FALSE OR NULL` is NULL, so the OR must
          // not accidentally let this through.
          id: ANN_PAST_SINGLE,
          venueId: VENUE,
          kind: 'concert',
          headliner: 'Past Single',
          showDate: dateOffset(-14),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
        },
      ])
      .onConflictDoNothing();
  });

  after(async () => {
    await cleanupByPrefix(PREFIX);
  });

  async function feedIds(): Promise<string[]> {
    const result = await callerFor(USER_ID).discover.followedFeed({ limit: 100 });
    return result.items.filter((i) => i.id.startsWith(PREFIX)).map((i) => i.id);
  }

  it('keeps an in-progress run whose first night has passed', async () => {
    const ids = await feedIds();
    assert.ok(
      ids.includes(ANN_ONGOING_RUN),
      'a run with 87 performances left must stay in the followed-venues feed',
    );
  });

  it('hides a run that has finished', async () => {
    const ids = await feedIds();
    assert.ok(!ids.includes(ANN_FINISHED_RUN), 'a closed run should not be served');
  });

  it('still serves a future single-night announcement', async () => {
    const ids = await feedIds();
    assert.ok(ids.includes(ANN_FUTURE_SINGLE));
  });

  it('still hides a past single-night announcement with a null runEndDate', async () => {
    const ids = await feedIds();
    assert.ok(
      !ids.includes(ANN_PAST_SINGLE),
      'nullable runEndDate must not widen the filter for single-night rows',
    );
  });

  it('paginates in-progress runs without duplicates, emitting clamped cursors', async () => {
    // The feed orders by GREATEST(showDate, CURRENT_DATE) and cursors are
    // emitted in that same clamped space. If a cursor ever carried a run's
    // raw past first night while the SQL compared clamped dates (or vice
    // versa), page N+1 would either repeat or skip rows. Walk the feed one
    // row at a time and assert the union is exact and duplicate-free, and
    // that no emitted cursor dates a page boundary in the past.
    const today = new Date().toISOString().slice(0, 10);
    const caller = callerFor(USER_ID);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await caller.discover.followedFeed({ cursor, limit: 1 });
      for (const item of page.items) {
        if (item.id.startsWith(PREFIX)) seen.push(item.id);
      }
      if (!page.nextCursor) break;
      const cursorDate = page.nextCursor.split('|')[0]!;
      assert.ok(
        cursorDate >= today,
        `cursor date ${cursorDate} must not point into the past`,
      );
      cursor = page.nextCursor;
    }
    const expected = [
      ANN_ONGOING_RUN,
      ANN_ONGOING_RUN_B,
      ANN_FUTURE_SINGLE,
    ].sort();
    assert.deepEqual([...seen].sort(), expected, 'exact visible set served');
    assert.equal(seen.length, new Set(seen).size, 'no duplicates across pages');
  });
});
