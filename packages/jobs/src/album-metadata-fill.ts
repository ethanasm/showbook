/**
 * Phase 11 §15m — album-metadata-fill cron.
 *
 * For each performer with a `spotify_artist_id`, fetch the latest 5
 * albums from Spotify's public catalog (`/v1/artists/{id}/albums`) +
 * each album's track list (`/v1/albums/{id}/tracks`). Upsert into the
 * `albums` table so the §15m album-drop forward signal can synthesize
 * Tier-A appearances for new-album tracks within the ±60-day window
 * around the prediction target.
 *
 * Uses the app-level `client_credentials` token — no user OAuth scope
 * required (this is public catalog data). Cached at the spotify.ts
 * module level with a 50-minute TTL.
 *
 * Schedule: 02:30 ET nightly. Lands before the corpus-fill refresh at
 * 04:45 ET so prediction reads after 04:45 see fresh albums alongside
 * fresh corpus.
 */

import './load-env-local';

import { isNotNull } from 'drizzle-orm';
import { albums, db, performers } from '@showbook/db';
import {
  getAppAccessToken,
  getAlbumTracks,
  getArtistAlbums,
  SpotifyError,
  withAppToken,
} from '@showbook/api';
import { child } from '@showbook/observability';

const log = child({ component: 'jobs.album-metadata-fill' });

const ALBUMS_PER_PERFORMER = 5;

export interface AlbumMetadataFillSummary {
  attempted: number;
  performersUpdated: number;
  albumsUpserted: number;
  failed: number;
}

export async function runAlbumMetadataFill(): Promise<AlbumMetadataFillSummary> {
  const rows = await db
    .select({
      id: performers.id,
      spotifyArtistId: performers.spotifyArtistId,
      name: performers.name,
    })
    .from(performers)
    .where(isNotNull(performers.spotifyArtistId));

  let attempted = 0;
  let performersUpdated = 0;
  let albumsUpserted = 0;
  let failed = 0;

  // Probe the app-level token once up front so a credentials misconfig
  // surfaces as `token_failed` (and skips the cron) rather than as a
  // per-performer `performer_failed` cascade. The per-call token is
  // sourced inside `withAppToken` below so the cron survives mid-loop
  // expiry of a cached token.
  try {
    await getAppAccessToken();
  } catch (err) {
    log.error(
      { event: 'album_metadata_fill.token_failed', err },
      'app-level token fetch failed; cron skipped',
    );
    return { attempted: 0, performersUpdated: 0, albumsUpserted: 0, failed: 0 };
  }

  for (const performer of rows) {
    if (!performer.spotifyArtistId) continue;
    attempted += 1;
    try {
      const fetched = await withAppToken((token) =>
        getArtistAlbums(performer.spotifyArtistId!, token, {
          limit: ALBUMS_PER_PERFORMER,
        }),
      );
      if (fetched.length === 0) continue;
      let perPerformerUpserts = 0;
      for (const album of fetched) {
        try {
          const tracks = await withAppToken((token) =>
            getAlbumTracks(album.id, token),
          );
          if (tracks.trackIds.length === 0) continue;
          await db
            .insert(albums)
            .values({
              performerId: performer.id,
              spotifyAlbumId: album.id,
              name: album.name,
              releaseDate: album.releaseDate,
              albumType: album.albumType,
              trackIds: tracks.trackIds,
              fetchedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: albums.spotifyAlbumId,
              set: {
                performerId: performer.id,
                name: album.name,
                releaseDate: album.releaseDate,
                albumType: album.albumType,
                trackIds: tracks.trackIds,
                fetchedAt: new Date(),
              },
            });
          perPerformerUpserts += 1;
        } catch (err) {
          log.warn(
            {
              event: 'album_metadata_fill.album_failed',
              err,
              performerId: performer.id,
              albumId: album.id,
            },
            'album metadata fetch failed; continuing',
          );
        }
      }
      if (perPerformerUpserts > 0) {
        performersUpdated += 1;
        albumsUpserted += perPerformerUpserts;
      }
    } catch (err) {
      failed += 1;
      const isSpotifyErr = err instanceof SpotifyError;
      log.error(
        {
          event: 'album_metadata_fill.performer_failed',
          err,
          performerId: performer.id,
          performerName: performer.name,
          status: isSpotifyErr ? err.status : undefined,
        },
        'album metadata fill failed for performer',
      );
    }
  }

  log.info(
    {
      event: 'album_metadata_fill.summary',
      attempted,
      performersUpdated,
      albumsUpserted,
      failed,
    },
    'album-metadata-fill complete',
  );
  return { attempted, performersUpdated, albumsUpserted, failed };
}
