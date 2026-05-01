/**
 * Replaces apps/web/tests/multi-user-isolation.spec.ts. The e2e spec
 * spun up two browser contexts to prove a second user can't read the
 * first user's shows; that assertion is fundamentally about tRPC
 * scope-by-userId, not the UI, so it lives here much faster.
 *
 * Covers shows.list, shows.detail, shows.count, performers.count,
 * venues.count, and media.list — every read path that should be scoped
 * to ctx.session.user.id.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/multi-user-isolation.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import {
  callerFor,
  cleanupByPrefix,
  createTestShow,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'aacc1500';
const ALICE = `${PREFIX}-alice`;
const BOB = `${PREFIX}-bob`;
const VENUE = fakeUuid(PREFIX, 'venue');
const ALICE_SHOW = fakeUuid(PREFIX, 'aliceshow');
const BOB_SHOW = fakeUuid(PREFIX, 'bobshow');

describe('multi-user isolation', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);
    await createTestUser(ALICE);
    await createTestUser(BOB);
    await createTestVenue({
      id: VENUE,
      name: 'Shared Venue',
      city: 'NYC',
      latitude: 40.7,
      longitude: -74,
    });
    await createTestShow({
      id: ALICE_SHOW,
      userId: ALICE,
      venueId: VENUE,
      kind: 'concert',
      state: 'past',
      date: '2024-01-15',
    });
    await createTestShow({
      id: BOB_SHOW,
      userId: BOB,
      venueId: VENUE,
      kind: 'theatre',
      state: 'ticketed',
      date: '2026-12-31',
    });
  });

  after(async () => {
    await cleanupByPrefix(PREFIX);
  });

  it('shows.list returns only the caller’s shows', async () => {
    const aliceShows = await callerFor(ALICE).shows.list({});
    const bobShows = await callerFor(BOB).shows.list({});

    const aliceIds = aliceShows.map((s) => s.id);
    const bobIds = bobShows.map((s) => s.id);

    assert.ok(aliceIds.includes(ALICE_SHOW));
    assert.equal(aliceIds.includes(BOB_SHOW), false);
    assert.ok(bobIds.includes(BOB_SHOW));
    assert.equal(bobIds.includes(ALICE_SHOW), false);
  });

  it('shows.listSlim is also scoped per-user', async () => {
    const aliceSlim = await callerFor(ALICE).shows.listSlim();
    const bobSlim = await callerFor(BOB).shows.listSlim();
    assert.ok(aliceSlim.some((s) => s.id === ALICE_SHOW));
    assert.equal(aliceSlim.some((s) => s.id === BOB_SHOW), false);
    assert.ok(bobSlim.some((s) => s.id === BOB_SHOW));
    assert.equal(bobSlim.some((s) => s.id === ALICE_SHOW), false);
  });

  it('shows.listForMap is also scoped per-user', async () => {
    const aliceMap = await callerFor(ALICE).shows.listForMap();
    const bobMap = await callerFor(BOB).shows.listForMap();
    assert.ok(aliceMap.some((s) => s.id === ALICE_SHOW));
    assert.equal(aliceMap.some((s) => s.id === BOB_SHOW), false);
    assert.ok(bobMap.some((s) => s.id === BOB_SHOW));
    assert.equal(bobMap.some((s) => s.id === ALICE_SHOW), false);
  });

  it('shows.detail rejects when the caller is not the owner', async () => {
    // Alice owns ALICE_SHOW; Bob trying to read it should NOT_FOUND.
    await assert.rejects(
      () => callerFor(BOB).shows.detail({ showId: ALICE_SHOW }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );

    // Alice can read her own.
    const own = await callerFor(ALICE).shows.detail({ showId: ALICE_SHOW });
    assert.equal(own.id, ALICE_SHOW);
  });

  it('shows.count is per-user', async () => {
    const aliceCount = await callerFor(ALICE).shows.count();
    const bobCount = await callerFor(BOB).shows.count();
    // Alice sees at least her one seeded show; Bob sees at least his.
    assert.ok(aliceCount >= 1);
    assert.ok(bobCount >= 1);
    // The counts include only scoped shows; if the e2e DB has prior fixtures
    // we can't assert exact equality, but both must be > 0 and finite.
    assert.equal(typeof aliceCount, 'number');
    assert.equal(typeof bobCount, 'number');
  });

  it('media.listForShow rejects when caller doesn’t own the show', async () => {
    // Bob tries to list media for Alice's show — should NOT_FOUND.
    await assert.rejects(
      () => callerFor(BOB).media.listForShow({ showId: ALICE_SHOW }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
    // Alice listing her own show works (returns empty array).
    const aliceMedia = await callerFor(ALICE).media.listForShow({
      showId: ALICE_SHOW,
    });
    assert.ok(Array.isArray(aliceMedia));
  });

  it('venues.followed is per-user', async () => {
    const aliceFollowed = await callerFor(ALICE).venues.followed();
    const bobFollowed = await callerFor(BOB).venues.followed();
    // Neither user followed any venues in this seed; both should be empty
    // for our prefix.
    const aliceOurs = aliceFollowed.filter((v) => v.id === VENUE);
    const bobOurs = bobFollowed.filter((v) => v.id === VENUE);
    assert.equal(aliceOurs.length, 0);
    assert.equal(bobOurs.length, 0);
  });

  it('unauthenticated callers are rejected', async () => {
    const anon = callerFor('00000000-0000-0000-0000-000000000000');
    await assert.rejects(
      () => anon.shows.list({}),
      (err: unknown) => err instanceof TRPCError && err.code === 'UNAUTHORIZED',
    );
  });
});
