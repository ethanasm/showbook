/**
 * SI-10 — weekly purge of revoked Spotify tokens older than 30 days.
 *
 * `/api/spotify/disconnect` flips `revoked_at` instead of deleting the
 * row so a security audit can confirm "the token was revoked at T". The
 * 30-day window is the documented audit lifetime; this cron clears
 * anything older. Runs Sunday 02:00 ET — well outside the digest
 * window (08:00 ET) so a slow DELETE can't block the morning send.
 *
 * Schedule: weekly, Sunday 02:00 ET.
 */

import './load-env-local';

import { and, isNotNull, lt, sql } from 'drizzle-orm';
import { db, userSpotifyTokens } from '@showbook/db';
import { child } from '@showbook/observability';

const log = child({ component: 'jobs.spotify-purge-revoked-tokens' });

export interface PurgeRevokedSummary {
  rowsDeleted: number;
}

export async function runSpotifyPurgeRevokedTokens(): Promise<PurgeRevokedSummary> {
  const result = await db
    .delete(userSpotifyTokens)
    .where(
      and(
        isNotNull(userSpotifyTokens.revokedAt),
        lt(userSpotifyTokens.revokedAt, sql`now() - interval '30 days'`),
      ),
    )
    .returning({ userId: userSpotifyTokens.userId });

  const rowsDeleted = result.length;
  log.info(
    {
      event: 'spotify.purge_revoked.summary',
      rowsDeleted,
    },
    'Revoked-token purge complete',
  );
  return { rowsDeleted };
}
