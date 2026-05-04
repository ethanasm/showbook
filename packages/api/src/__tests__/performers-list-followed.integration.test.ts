/**
 * Integration test for performers.list with follow-only artists.
 *
 * Regression coverage for the LEFT JOIN added in PR2 (artists IA cleanup):
 * a Spotify-imported follow with no logged shows must still render a row
 * on /artists. Without the JOIN, the Get Started hub's "Import artists
 * from Spotify" door has no visible destination.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, performers, shows, showPerformers, userPerformerFollows } from '@showbook/db';
import {
  callerFor,
  cleanupByPrefix,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'plf01a';
const USER_ID = `${PREFIX}-user`;

const VENUE = fakeUuid(PREFIX, 'venue');
const SHOW_PERF = fakeUuid(PREFIX, 'showperf');
const FOLLOW_ONLY = fakeUuid(PREFIX, 'followonly');
const BOTH = fakeUuid(PREFIX, 'both');

const SHOW_A = fakeUuid(PREFIX, 'showA');
const SHOW_B = fakeUuid(PREFIX, 'showB');

describe('performers.list — follow-only artists', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER_ID);
    await createTestVenue({ id: VENUE, name: `${PREFIX} venue`, city: 'NYC' });

    await db.insert(performers).values([
      { id: SHOW_PERF, name: `${PREFIX} ShowOnly` },
      { id: FOLLOW_ONLY, name: `${PREFIX} FollowOnly` },
      { id: BOTH, name: `${PREFIX} Both` },
    ]).onConflictDoNothing();

    // SHOW_PERF: headliner of a past show. Not followed.
    // BOTH: headliner of an upcoming show AND followed.
    // FOLLOW_ONLY: followed only, no shows.
    await db.insert(shows).values([
      { id: SHOW_A, userId: USER_ID, venueId: VENUE, kind: 'concert', state: 'past', date: '2024-01-15' },
      { id: SHOW_B, userId: USER_ID, venueId: VENUE, kind: 'concert', state: 'ticketed', date: '2099-12-01' },
    ]).onConflictDoNothing();

    await db.insert(showPerformers).values([
      { showId: SHOW_A, performerId: SHOW_PERF, role: 'headliner', sortOrder: 0 },
      { showId: SHOW_B, performerId: BOTH, role: 'headliner', sortOrder: 0 },
    ]).onConflictDoNothing();

    await db.insert(userPerformerFollows).values([
      { userId: USER_ID, performerId: BOTH },
      { userId: USER_ID, performerId: FOLLOW_ONLY },
    ]).onConflictDoNothing();
  });

  after(async () => {
    await cleanupByPrefix(PREFIX);
  });

  it('returns followed artists with no shows alongside show-derived artists', async () => {
    const result = await callerFor(USER_ID).performers.list();
    const byId = new Map(result.map((r) => [r.id, r]));

    const showOnly = byId.get(SHOW_PERF);
    assert.ok(showOnly, 'show-derived performer should appear');
    assert.equal(showOnly!.isFollowed, false);
    assert.equal(showOnly!.showCount, 1);
    assert.equal(showOnly!.pastShowsCount, 1);

    const followOnly = byId.get(FOLLOW_ONLY);
    assert.ok(followOnly, 'follow-only performer must appear (Spotify-import case)');
    assert.equal(followOnly!.isFollowed, true);
    assert.equal(followOnly!.showCount, 0);
    assert.equal(followOnly!.pastShowsCount, 0);
    assert.equal(followOnly!.futureShowsCount, 0);
    assert.equal(followOnly!.lastSeen, null);
    assert.equal(followOnly!.firstSeen, null);

    const both = byId.get(BOTH);
    assert.ok(both, 'show-derived AND followed performer must appear exactly once');
    assert.equal(both!.isFollowed, true);
    assert.equal(both!.showCount, 1);
    assert.equal(both!.futureShowsCount, 1);

    const ourIds = new Set([SHOW_PERF, FOLLOW_ONLY, BOTH]);
    const ours = result.filter((r) => ourIds.has(r.id));
    assert.equal(ours.length, 3, 'no duplicate rows when a performer matches both sources');
  });
});
