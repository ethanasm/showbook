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
});
