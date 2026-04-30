/**
 * Verifies the show-ownership tightening on media.setPerformers
 * (commit cb5bde0). A user with a forged assetId pointing to another
 * user's show — even one they own a media asset on — must not be able
 * to mutate that show's performer list.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/media-set-performers.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { db, mediaAssets, performers, showPerformers } from '@showbook/db';
import { sql, eq, and } from 'drizzle-orm';
import {
  callerFor,
  cleanupByPrefix,
  createTestShow,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'aa11ad00';

const USER_A = `${PREFIX}-user-a`;
const USER_B = `${PREFIX}-user-b`;
const VENUE_ID = fakeUuid(PREFIX, 'venue');
const SHOW_A = fakeUuid(PREFIX, 'showa');
const SHOW_B = fakeUuid(PREFIX, 'showb');
const PERFORMER_ID = fakeUuid(PREFIX, 'perf');
const ASSET_FOR_A = fakeUuid(PREFIX, 'asset');

async function seedMediaAsset(assetId: string, userId: string, showId: string) {
  await db
    .insert(mediaAssets)
    .values({
      id: assetId,
      userId,
      showId,
      mediaType: 'photo',
      status: 'ready',
      storageKey: `test/${assetId}`,
      mimeType: 'image/png',
      bytes: 1024,
    })
    .onConflictDoNothing();
}

describe('media.setPerformers ownership', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER_A);
    await createTestUser(USER_B);
    await createTestVenue({
      id: VENUE_ID,
      name: 'Test Venue',
      city: 'Nashville',
    });
    await createTestShow({ id: SHOW_A, userId: USER_A, venueId: VENUE_ID });
    await createTestShow({ id: SHOW_B, userId: USER_B, venueId: VENUE_ID });
    await db
      .insert(performers)
      .values({ id: PERFORMER_ID, name: 'Test Performer' })
      .onConflictDoNothing();
    await seedMediaAsset(ASSET_FOR_A, USER_A, SHOW_A);
  });

  after(async () => {
    await cleanupByPrefix(PREFIX);
  });

  it('owner can set performers on their own asset', async () => {
    const result = await callerFor(USER_A).media.setPerformers({
      assetId: ASSET_FOR_A,
      performerIds: [PERFORMER_ID],
    });
    assert.deepEqual(result.performerIds, [PERFORMER_ID]);

    // showPerformer was created on USER_A's show.
    const sp = await db
      .select()
      .from(showPerformers)
      .where(
        and(
          eq(showPerformers.showId, SHOW_A),
          eq(showPerformers.performerId, PERFORMER_ID),
        ),
      );
    assert.equal(sp.length, 1);
  });

  it('non-owner gets NOT_FOUND when asking about another user’s asset', async () => {
    await assert.rejects(
      () =>
        callerFor(USER_B).media.setPerformers({
          assetId: ASSET_FOR_A,
          performerIds: [PERFORMER_ID],
        }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });

  it('asset rows whose show belongs to a different user also reject', async () => {
    // Forge: re-point ASSET_FOR_A's show_id to USER_B's show, keeping
    // userId at USER_A. The procedure must still refuse because
    // shows.user_id != userId.
    await db
      .update(mediaAssets)
      .set({ showId: SHOW_B })
      .where(eq(mediaAssets.id, ASSET_FOR_A));

    // Sanity-check the forge actually landed.
    const [forged] = await db
      .select({ userId: mediaAssets.userId, showId: mediaAssets.showId })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, ASSET_FOR_A));
    assert.equal(forged?.userId, USER_A);
    assert.equal(forged?.showId, SHOW_B);

    await assert.rejects(
      () =>
        callerFor(USER_A).media.setPerformers({
          assetId: ASSET_FOR_A,
          performerIds: [PERFORMER_ID],
        }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'NOT_FOUND',
    );

    // Restore for cleanup symmetry.
    await db
      .update(mediaAssets)
      .set({ showId: SHOW_A })
      .where(eq(mediaAssets.id, ASSET_FOR_A));
  });

  it('NOT_FOUND on completely unknown assetId', async () => {
    await assert.rejects(
      () =>
        callerFor(USER_A).media.setPerformers({
          assetId: '00000000-0000-0000-0000-000000000000',
          performerIds: [],
        }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });
});

void sql; // keep import live for editors that strip unused
