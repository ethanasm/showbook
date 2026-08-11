/**
 * Integration tests for runPrunePastAnnouncements: the daily cron at
 * 02:00 ET that drops announcements whose last performance
 * (`COALESCE(run_end_date, show_date)`) is before today.
 *
 * Concurrency note: node:test runs integration test FILES in parallel,
 * so `runPruneOrphanCatalog()` from a sibling test file can fire mid-
 * test and wipe any row whose preserver predicate isn't satisfied yet.
 * Per-test seeds are therefore inserted inside a single `db.transaction`
 * so the sibling sweep can't observe an unanchored intermediate state —
 * on commit, every row and its preserver become visible together.
 *
 * Run with:
 *   pnpm --filter @showbook/jobs test:integration
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  db,
  users,
  shows,
  venues,
  announcements,
  showAnnouncementLinks,
  userPerformerFollows,
  userVenueFollows,
  performers,
  sql,
} from '@showbook/db';
import { like, eq } from 'drizzle-orm';
import { runPrunePastAnnouncements } from '../prune-past-announcements';

const PREFIX = 'eea0050a';

const USER_A = `${PREFIX}-1111-4111-8111-111111111111`;
const VENUE = `${PREFIX}-aaaa-4aaa-8aaa-aaaaaaaaaaa1`;
const PERFORMER = `${PREFIX}-cccc-4ccc-8ccc-cccccccccc01`;
const SHOW_X = `${PREFIX}-dddd-4ddd-8ddd-dddddddddd01`;

const ANN_PAST = `${PREFIX}-f000-4f00-8f00-f00000000001`;
const ANN_TODAY = `${PREFIX}-f000-4f00-8f00-f00000000002`;
const ANN_FUTURE = `${PREFIX}-f000-4f00-8f00-f00000000003`;
const ANN_PAST_LINKED = `${PREFIX}-f000-4f00-8f00-f00000000004`;
const ANN_PAST_FOLLOWED_PERFORMER = `${PREFIX}-f000-4f00-8f00-f00000000005`;
const ANN_ONGOING_RUN = `${PREFIX}-f000-4f00-8f00-f00000000006`;
const ANN_FINISHED_RUN = `${PREFIX}-f000-4f00-8f00-f00000000007`;

function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function cleanup(): Promise<void> {
  const p = `${PREFIX}%`;
  await db.execute(
    sql`DELETE FROM show_announcement_links WHERE show_id::text LIKE ${p} OR announcement_id::text LIKE ${p}`,
  );
  await db.delete(userVenueFollows).where(like(userVenueFollows.userId, p));
  await db.delete(userPerformerFollows).where(like(userPerformerFollows.userId, p));
  await db.delete(announcements).where(like(sql`${announcements.id}::text`, p));
  await db.delete(shows).where(like(sql`${shows.id}::text`, p));
  await db.delete(performers).where(like(sql`${performers.id}::text`, p));
  await db.delete(venues).where(like(sql`${venues.id}::text`, p));
  await db.delete(users).where(like(users.id, p));
}

describe('runPrunePastAnnouncements', () => {
  before(cleanup);
  after(cleanup);
  beforeEach(cleanup);

  it('deletes past-dated announcements and keeps today / future ones', async () => {
    // The venue-follow is a fixture preserver kept here so the
    // today / future announcements survive the orphan sweep that
    // `runPrunePastAnnouncements` is intentionally not gated by;
    // wrapping the seed in a transaction is what stops the sibling
    // sweep from observing the venue mid-insert.
    await db.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: USER_A, name: 'A', email: 'a@test.local' },
      ]);
      await tx.insert(venues).values([
        { id: VENUE, name: 'Hall', city: 'NYC', country: 'US' },
      ]);
      await tx.insert(userVenueFollows).values([
        { userId: USER_A, venueId: VENUE },
      ]);
      await tx.insert(announcements).values([
        {
          id: ANN_PAST,
          venueId: VENUE,
          kind: 'concert',
          headliner: 'Past',
          showDate: offsetDate(-1),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
          sourceEventId: `${PREFIX}-past`,
        },
        {
          id: ANN_TODAY,
          venueId: VENUE,
          kind: 'concert',
          headliner: 'Today',
          showDate: offsetDate(0),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
          sourceEventId: `${PREFIX}-today`,
        },
        {
          id: ANN_FUTURE,
          venueId: VENUE,
          kind: 'concert',
          headliner: 'Future',
          showDate: offsetDate(7),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
          sourceEventId: `${PREFIX}-future`,
        },
      ]);
    });

    const result = await runPrunePastAnnouncements();

    assert.ok(result.announcements >= 1, 'reports the dropped row count');
    const past = await db.select().from(announcements).where(eq(announcements.id, ANN_PAST));
    const today = await db.select().from(announcements).where(eq(announcements.id, ANN_TODAY));
    const future = await db.select().from(announcements).where(eq(announcements.id, ANN_FUTURE));
    assert.equal(past.length, 0, 'past announcement deleted');
    assert.equal(today.length, 1, 'today announcement preserved');
    assert.equal(future.length, 1, 'future announcement preserved');
  });

  it('keeps an in-progress multi-night run but drops a finished one', async () => {
    // `showDate` is a run's FIRST night. The original predicate
    // (`show_date < CURRENT_DATE`) deleted a Hamilton-style run the
    // morning after opening night, with the rest of the engagement
    // still to come — undoing the discover read-path fix that keeps
    // in-progress runs visible (`stillUpcoming()`).
    await db.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: USER_A, name: 'A', email: 'a@test.local' },
      ]);
      await tx.insert(venues).values([
        { id: VENUE, name: 'Hall', city: 'NYC', country: 'US' },
      ]);
      await tx.insert(userVenueFollows).values([
        { userId: USER_A, venueId: VENUE },
      ]);
      await tx.insert(announcements).values([
        {
          // Opened 3 days ago, runs for another 87 — must survive.
          id: ANN_ONGOING_RUN,
          venueId: VENUE,
          kind: 'theatre',
          headliner: 'Ongoing Run',
          productionName: 'Ongoing Run',
          showDate: offsetDate(-3),
          runStartDate: offsetDate(-3),
          runEndDate: offsetDate(87),
          performanceDates: [offsetDate(-3), offsetDate(87)],
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
          sourceEventId: `${PREFIX}-ongoing-run`,
        },
        {
          // Closed 10 days ago — must be deleted.
          id: ANN_FINISHED_RUN,
          venueId: VENUE,
          kind: 'theatre',
          headliner: 'Finished Run',
          productionName: 'Finished Run',
          showDate: offsetDate(-60),
          runStartDate: offsetDate(-60),
          runEndDate: offsetDate(-10),
          performanceDates: [offsetDate(-60), offsetDate(-10)],
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
          sourceEventId: `${PREFIX}-finished-run`,
        },
      ]);
    });

    await runPrunePastAnnouncements();

    const ongoing = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, ANN_ONGOING_RUN));
    const finished = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, ANN_FINISHED_RUN));
    assert.equal(ongoing.length, 1, 'in-progress run preserved mid-engagement');
    assert.equal(finished.length, 0, 'finished run deleted');
  });

  it('drops past announcements even when a followed performer would otherwise preserve them', async () => {
    // This is the bug that motivated the job: the orphan-prune
    // backstop preserves announcements whose headliner is followed,
    // so past announcements for followed artists accumulate forever.
    // The performer-follow is what we're verifying doesn't preserve
    // the past announcement; the venue-follow is incidental fixture.
    await db.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: USER_A, name: 'A', email: 'a@test.local' },
      ]);
      await tx.insert(venues).values([
        { id: VENUE, name: 'Hall', city: 'NYC', country: 'US' },
      ]);
      await tx.insert(userVenueFollows).values([
        { userId: USER_A, venueId: VENUE },
      ]);
      await tx.insert(performers).values([
        { id: PERFORMER, name: 'Followed Artist' },
      ]);
      await tx.insert(userPerformerFollows).values([
        { userId: USER_A, performerId: PERFORMER },
      ]);
      await tx.insert(announcements).values([
        {
          id: ANN_PAST_FOLLOWED_PERFORMER,
          venueId: VENUE,
          kind: 'concert',
          headliner: 'Followed Artist',
          headlinerPerformerId: PERFORMER,
          showDate: offsetDate(-1),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
          sourceEventId: `${PREFIX}-fol-past`,
        },
      ]);
    });

    await runPrunePastAnnouncements();

    const ann = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, ANN_PAST_FOLLOWED_PERFORMER));
    assert.equal(ann.length, 0, 'followed-performer past announcement still deleted');
  });

  it('cascade-drops the link row but keeps the linked user show', async () => {
    await db.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: USER_A, name: 'A', email: 'a@test.local' },
      ]);
      await tx.insert(venues).values([
        { id: VENUE, name: 'Hall', city: 'NYC', country: 'US' },
      ]);
      await tx.insert(userVenueFollows).values([
        { userId: USER_A, venueId: VENUE },
      ]);
      await tx.insert(shows).values([
        {
          id: SHOW_X,
          userId: USER_A,
          venueId: VENUE,
          kind: 'concert',
          state: 'past',
          date: offsetDate(-1),
        },
      ]);
      await tx.insert(announcements).values([
        {
          id: ANN_PAST_LINKED,
          venueId: VENUE,
          kind: 'concert',
          headliner: 'Linked Past',
          showDate: offsetDate(-1),
          onSaleStatus: 'on_sale',
          source: 'ticketmaster',
          sourceEventId: `${PREFIX}-linked-past`,
        },
      ]);
      await tx.insert(showAnnouncementLinks).values([
        { showId: SHOW_X, announcementId: ANN_PAST_LINKED },
      ]);
    });

    await runPrunePastAnnouncements();

    const ann = await db.select().from(announcements).where(eq(announcements.id, ANN_PAST_LINKED));
    const link = await db
      .select()
      .from(showAnnouncementLinks)
      .where(eq(showAnnouncementLinks.announcementId, ANN_PAST_LINKED));
    const show = await db.select().from(shows).where(eq(shows.id, SHOW_X));
    assert.equal(ann.length, 0, 'past announcement deleted');
    assert.equal(link.length, 0, 'link row cascaded away');
    assert.equal(show.length, 1, 'user show preserved');
  });
});
