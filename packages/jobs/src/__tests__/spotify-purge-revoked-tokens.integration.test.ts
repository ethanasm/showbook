/**
 * SI-10 — integration test for the weekly Spotify revoked-token purge.
 *
 * The cron deletes rows where `revoked_at < now() - 30 days`. This
 * test seeds three rows representing the three states the cron must
 * distinguish: a row revoked 31 days ago (deleted), a row revoked 5
 * days ago (kept), and a row that's never been revoked (kept).
 *
 * Run with:
 *   pnpm --filter @showbook/jobs test:integration
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  db,
  users,
  userSpotifyTokens,
  sql,
} from '@showbook/db';
import { eq, like } from 'drizzle-orm';
import { runSpotifyPurgeRevokedTokens } from '../spotify-purge-revoked-tokens';

const PREFIX = 'si10p042';

const USER_OLD_REVOKED = `${PREFIX}-1111-4111-8111-111111111111`;
const USER_RECENT_REVOKED = `${PREFIX}-2222-4222-8222-222222222222`;
const USER_LIVE = `${PREFIX}-3333-4333-8333-333333333333`;

async function cleanup(): Promise<void> {
  const p = `${PREFIX}%`;
  await db.delete(userSpotifyTokens).where(like(userSpotifyTokens.userId, p));
  await db.delete(users).where(like(users.id, p));
}

async function seedTokensWithRevokedAt(opts: {
  userId: string;
  revokedDaysAgo: number | null;
}): Promise<void> {
  await db.insert(users).values({
    id: opts.userId,
    name: `User ${opts.userId.slice(0, 6)}`,
    email: `${opts.userId.slice(0, 6)}@test.local`,
  });
  await db.insert(userSpotifyTokens).values({
    userId: opts.userId,
    accessTokenEnc: 'AAAA',
    refreshTokenEnc: 'BBBB',
    scope: 'user-read-private',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    spotifyUserId: `spotify_${opts.userId.slice(0, 8)}`,
    revokedAt:
      opts.revokedDaysAgo === null
        ? null
        : new Date(Date.now() - opts.revokedDaysAgo * 24 * 60 * 60 * 1000),
  });
}

describe('SI-10 — runSpotifyPurgeRevokedTokens', () => {
  before(cleanup);
  after(cleanup);
  beforeEach(cleanup);

  it('deletes rows revoked more than 30 days ago', async () => {
    await seedTokensWithRevokedAt({
      userId: USER_OLD_REVOKED,
      revokedDaysAgo: 31,
    });
    await seedTokensWithRevokedAt({
      userId: USER_RECENT_REVOKED,
      revokedDaysAgo: 5,
    });
    await seedTokensWithRevokedAt({
      userId: USER_LIVE,
      revokedDaysAgo: null,
    });

    const summary = await runSpotifyPurgeRevokedTokens();
    assert.equal(summary.rowsDeleted, 1);

    const remaining = await db
      .select({ userId: userSpotifyTokens.userId })
      .from(userSpotifyTokens)
      .where(like(userSpotifyTokens.userId, `${PREFIX}%`));
    const ids = remaining.map((r) => r.userId).sort();
    assert.deepEqual(ids, [USER_RECENT_REVOKED, USER_LIVE].sort());
  });

  it('returns rowsDeleted=0 when no rows qualify', async () => {
    await seedTokensWithRevokedAt({
      userId: USER_RECENT_REVOKED,
      revokedDaysAgo: 5,
    });
    await seedTokensWithRevokedAt({
      userId: USER_LIVE,
      revokedDaysAgo: null,
    });

    const summary = await runSpotifyPurgeRevokedTokens();
    assert.equal(summary.rowsDeleted, 0);
  });

  it('deletes ALL old rows when multiple qualify', async () => {
    const extraOldId = `${PREFIX}-4444-4444-8444-444444444444`;
    await seedTokensWithRevokedAt({
      userId: USER_OLD_REVOKED,
      revokedDaysAgo: 31,
    });
    await seedTokensWithRevokedAt({
      userId: extraOldId,
      revokedDaysAgo: 90,
    });
    await seedTokensWithRevokedAt({
      userId: USER_LIVE,
      revokedDaysAgo: null,
    });

    const summary = await runSpotifyPurgeRevokedTokens();
    assert.equal(summary.rowsDeleted, 2);

    const remaining = await db
      .select({ userId: userSpotifyTokens.userId })
      .from(userSpotifyTokens)
      .where(like(userSpotifyTokens.userId, `${PREFIX}%`));
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]!.userId, USER_LIVE);
  });
});

// Silence unused-import warnings.
void sql;
void eq;
