import { and, eq, isNull } from 'drizzle-orm';
import { db, performers } from '@showbook/db';
import { child } from '@showbook/observability';
import { getAppAccessToken, searchSpotifyArtist, SpotifyError } from './spotify';
import { isUniqueViolation } from './venue-matcher';

const log = child({ component: 'api.resolve-performer-spotify-id' });

export type ResolvePerformerSpotifyIdOutcome =
  | { kind: 'updated'; spotifyArtistId: string }
  | { kind: 'no_match' }
  | { kind: 'skipped'; reason: 'row_already_filled' | 'other_row_owns_id' }
  | { kind: 'failed'; err: unknown };

/**
 * Resolve a performer's `spotify_artist_id` by name via Spotify's
 * public `/v1/search?type=artist` and persist with a race-guarded
 * UPDATE.
 *
 * Used by:
 *   - `matchOrCreatePerformer` as a fire-and-forget hook after every
 *     newly-created row (so every ingest path — Add Show form, chat
 *     Add, scrapers, discover ingest, festival lineup picker, Spotify
 *     follow import — ends up populating the column).
 *   - The `backfill-performer-spotify-ids` cron and operator-triggered
 *     one-shot for catching up the existing backlog.
 *
 * Race guard: the UPDATE includes `spotifyArtistId IS NULL` in the
 * WHERE clause so a concurrent fill (operator-triggered cron + inline
 * hook on the same row) doesn't silently overwrite. The partial unique
 * index `performers_spotify_artist_uniq` catches the case where a
 * different performer row already owns this Spotify ID (duplicate-
 * performer cleanup is an operator merge, not a per-job task).
 */
export async function resolvePerformerSpotifyId(
  performerId: string,
  performerName: string,
): Promise<ResolvePerformerSpotifyIdOutcome> {
  // Fast-skip when Spotify app credentials aren't configured (CI test
  // shards, dev environments without a .env.local Spotify section).
  // Without this the fire-and-forget hook in matchOrCreatePerformer
  // would log `performer.spotify_id.token_failed` for every newly-
  // created performer row in those envs.
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    return {
      kind: 'failed',
      err: new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set'),
    };
  }

  let token: string;
  try {
    token = await getAppAccessToken();
  } catch (err) {
    log.error(
      { err, event: 'performer.spotify_id.token_failed', performerId },
      'app-level token fetch failed; cannot resolve',
    );
    return { kind: 'failed', err };
  }

  let hit;
  try {
    hit = await searchSpotifyArtist(token, performerName);
  } catch (err) {
    log.error(
      {
        err,
        event: 'performer.spotify_id.failed',
        performerId,
        performerName,
        status: err instanceof SpotifyError ? err.status : undefined,
      },
      'Spotify artist search failed',
    );
    return { kind: 'failed', err };
  }

  if (!hit) {
    log.info(
      {
        event: 'performer.spotify_id.no_match',
        performerId,
        performerName,
      },
      'No Spotify artist match for performer',
    );
    return { kind: 'no_match' };
  }

  try {
    const result = await db
      .update(performers)
      .set({ spotifyArtistId: hit.id })
      .where(
        and(
          eq(performers.id, performerId),
          isNull(performers.spotifyArtistId),
        ),
      )
      .returning({ id: performers.id });

    if (result.length === 0) {
      log.warn(
        {
          event: 'performer.spotify_id.conflict',
          performerId,
          performerName,
          spotifyArtistId: hit.id,
          reason: 'row_already_filled',
        },
        'Spotify ID set by another writer between SELECT and UPDATE',
      );
      return { kind: 'skipped', reason: 'row_already_filled' };
    }

    log.info(
      {
        event: 'performer.spotify_id.updated',
        performerId,
        performerName,
        spotifyArtistId: hit.id,
      },
      'Resolved performer Spotify ID',
    );
    return { kind: 'updated', spotifyArtistId: hit.id };
  } catch (err) {
    if (isUniqueViolation(err)) {
      log.warn(
        {
          event: 'performer.spotify_id.conflict',
          performerId,
          performerName,
          spotifyArtistId: hit.id,
          reason: 'other_row_owns_id',
        },
        'Spotify ID already owned by another performer row — leaving this row null',
      );
      return { kind: 'skipped', reason: 'other_row_owns_id' };
    }
    log.error(
      {
        err,
        event: 'performer.spotify_id.failed',
        performerId,
        performerName,
        spotifyArtistId: hit.id,
      },
      'Persisting Spotify ID failed',
    );
    return { kind: 'failed', err };
  }
}
