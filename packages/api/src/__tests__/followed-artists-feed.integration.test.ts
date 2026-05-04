/**
 * Regression for discover.followedArtistsFeed: with multiple followed
 * performers the procedure must NOT throw a SQLSTATE 42846 ("cannot
 * cast type record to uuid[]") at the support_performer_ids overlap
 * branch. The original bug interpolated a JS array into a Drizzle
 * `sql` template — it expanded as a parameter tuple ($1, $2, …) which
 * cannot be cast to uuid[]. Fixed by switching to drizzle's
 * `arrayOverlaps` helper.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/followed-artists-feed.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  db,
  announcements,
  performers,
  userPerformerFollows,
} from '@showbook/db';
import {
  callerFor,
  cleanupByPrefix,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'aabbf002';
const USER_ID = `${PREFIX}-user`;

const VENUE = fakeUuid(PREFIX, 'venue');

const HEADLINER = fakeUuid(PREFIX, 'head');
const SUPPORT_A = fakeUuid(PREFIX, 'sa');
const SUPPORT_B = fakeUuid(PREFIX, 'sb');
// Followed but no announcements reference them — the feed has to
// tolerate a multi-row IN/overlap list across both branches.
const EXTRA_A = fakeUuid(PREFIX, 'ea');
const EXTRA_B = fakeUuid(PREFIX, 'eb');

const ANN_HEADLINER = fakeUuid(PREFIX, 'ah');
const ANN_SUPPORT = fakeUuid(PREFIX, 'as');

function dateInFuture(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function seedPerformer(id: string, name: string) {
  await db.insert(performers).values({ id, name }).onConflictDoNothing();
}

async function follow(userId: string, performerId: string) {
  await db
    .insert(userPerformerFollows)
    .values({ userId, performerId })
    .onConflictDoNothing();
}

describe('discover.followedArtistsFeed', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER_ID);
    await createTestVenue({ id: VENUE, name: 'Test Hall', city: 'NYC' });

    await seedPerformer(HEADLINER, 'Headliner');
    await seedPerformer(SUPPORT_A, 'Support A');
    await seedPerformer(SUPPORT_B, 'Support B');
    await seedPerformer(EXTRA_A, 'Extra A');
    await seedPerformer(EXTRA_B, 'Extra B');

    await follow(USER_ID, HEADLINER);
    await follow(USER_ID, SUPPORT_A);
    await follow(USER_ID, SUPPORT_B);
    await follow(USER_ID, EXTRA_A);
    await follow(USER_ID, EXTRA_B);

    // Announcement headlined by a followed performer.
    await db
      .insert(announcements)
      .values({
        id: ANN_HEADLINER,
        venueId: VENUE,
        kind: 'concert',
        headliner: 'Headliner',
        headlinerPerformerId: HEADLINER,
        showDate: dateInFuture(7),
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
      })
      .onConflictDoNothing();

    // Announcement where a followed performer is in support_performer_ids.
    await db
      .insert(announcements)
      .values({
        id: ANN_SUPPORT,
        venueId: VENUE,
        kind: 'concert',
        headliner: 'Some Other Headliner',
        supportPerformerIds: [SUPPORT_A],
        showDate: dateInFuture(14),
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
      })
      .onConflictDoNothing();
  });

  after(async () => {
    await cleanupByPrefix(PREFIX);
  });

  it('does not throw with multiple followed performers (regression: 42846 cannot cast type record to uuid[])', async () => {
    const result = await callerFor(USER_ID).discover.followedArtistsFeed({});
    const ids = result.items.map((i) => i.id).filter((id) => id.startsWith(PREFIX));
    // Both branches matched: headliner OR support overlap.
    assert.ok(ids.includes(ANN_HEADLINER), 'headliner-branch announcement missing');
    assert.ok(ids.includes(ANN_SUPPORT), 'support-overlap-branch announcement missing');
  });

  it('returns empty when the user follows no performers', async () => {
    const otherUser = `${PREFIX}-noopuser`;
    await createTestUser(otherUser);
    const result = await callerFor(otherUser)
      .discover.followedArtistsFeed({});
    assert.equal(result.items.length, 0);
  });
});
