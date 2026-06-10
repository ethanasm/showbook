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
 *
 * Throughput / pg-boss expiry: the corpus is large (~1.2k performers ×
 * up to 6 Spotify calls each) and Spotify rate-limits aggressively, so
 * `spotifyFetch`'s 429 backoff makes a full sweep slow. The job runs
 * under `LONG_BATCH_CRON` (1800s pg-boss `expireInSeconds`); a sweep
 * that overruns that budget gets killed mid-flight and lands in pg-boss
 * `failed` state (which then trips the `pgboss_queue` morning health
 * check). To stay inside the expiry we cap the loop at a wall-clock
 * budget (default 25 min, well under 1800s) and stop cleanly with a
 * partial summary instead of grinding to the kill. Performers are
 * processed stalest-first (oldest / never-fetched album metadata) so a
 * budget-truncated run still makes forward progress across the whole
 * corpus over successive nights rather than re-refreshing the same head.
 *
 * Rate limiting: `spotifyFetch` bounds its 429 retry/backoff per call
 * (it no longer recurses forever), so a sustained 429 storm surfaces here
 * as a thrown `SpotifyError(status=429)`. We stop the run cleanly on the
 * first such throw — burning the rest of the budget on calls that will
 * keep getting 429'd just risks overrunning the pg-boss expiry again and
 * floods `error_volume` with per-performer errors. The stalest-first
 * ordering means the skipped performers lead the next night's run.
 */

import './load-env-local';

import { isNotNull, sql } from 'drizzle-orm';
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

/**
 * Wall-clock budget for a single run. Kept comfortably under the 1800s
 * pg-boss `expireInSeconds` for `LONG_BATCH_CRON` so a slow (rate-limited)
 * sweep returns cleanly with partial progress rather than being killed
 * and marked `failed`. Operator-tunable via env without a redeploy.
 */
const DEFAULT_TIME_BUDGET_MS = 25 * 60 * 1000;

/**
 * Number of back-to-back 401s (with no intervening success) that we treat
 * as a run-wide authorization failure once the run has already had at
 * least one success. Before any success, the very first 401 is already
 * run-wide (the app token is being rejected outright).
 */
const AUTH_ABORT_CONSECUTIVE = 5;

function resolveBudgetMs(): number {
  const raw = process.env.ALBUM_METADATA_FILL_BUDGET_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIME_BUDGET_MS;
}

export interface AlbumMetadataFillSummary {
  attempted: number;
  performersUpdated: number;
  albumsUpserted: number;
  failed: number;
}

export interface RunAlbumMetadataFillOptions {
  /** Wall-clock budget in ms. Defaults to env / `DEFAULT_TIME_BUDGET_MS`. */
  budgetMs?: number;
  /** Injectable clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export async function runAlbumMetadataFill(
  opts: RunAlbumMetadataFillOptions = {},
): Promise<AlbumMetadataFillSummary> {
  const budgetMs = opts.budgetMs ?? resolveBudgetMs();
  const now = opts.now ?? Date.now;

  // Stalest-first: never-fetched performers (NULL max fetched_at) lead,
  // then those whose album metadata is oldest. A budget-truncated run
  // therefore spends its budget where coverage is weakest and the corpus
  // cycles over successive nights instead of re-refreshing the same head.
  const rows = await db
    .select({
      id: performers.id,
      spotifyArtistId: performers.spotifyArtistId,
      name: performers.name,
    })
    .from(performers)
    .where(isNotNull(performers.spotifyArtistId))
    .orderBy(
      sql`(select max(${albums.fetchedAt}) from ${albums} where ${albums.performerId} = ${performers.id}) asc nulls first`,
    );

  let attempted = 0;
  let performersUpdated = 0;
  let albumsUpserted = 0;
  let failed = 0;
  let consecutiveAuthFailures = 0;

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

  const startedAt = now();

  for (let i = 0; i < rows.length; i += 1) {
    const performer = rows[i]!;
    if (!performer.spotifyArtistId) continue;

    // Stop before the pg-boss expiry kills us mid-flight. Returning here
    // lets pg-boss mark the run `complete` with the work done so far; the
    // remaining stalest performers lead the next run.
    const elapsedMs = now() - startedAt;
    if (elapsedMs > budgetMs) {
      log.warn(
        {
          event: 'album_metadata_fill.budget_exhausted',
          attempted,
          performersUpdated,
          albumsUpserted,
          remaining: rows.length - i,
          elapsedMs,
        },
        'time budget exhausted; stopping run with partial progress',
      );
      break;
    }

    attempted += 1;
    try {
      const fetched = await withAppToken((token) =>
        getArtistAlbums(performer.spotifyArtistId!, token, {
          limit: ALBUMS_PER_PERFORMER,
        }),
      );
      consecutiveAuthFailures = 0;
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
      const status = err instanceof SpotifyError ? err.status : undefined;

      // A 429 means `spotifyFetch` already exhausted its per-call retry +
      // backoff budget before throwing, so Spotify is rate-limiting the app
      // token hard. Stop the run cleanly with partial progress rather than
      // burning the rest of the budget on calls that will keep getting 429'd
      // — and rather than logging a per-performer error for each, which would
      // trip the `error_volume` health check. Performers are processed
      // stalest-first, so the ones we skip lead the next night's run. This
      // mirrors the setlist.fm corpus-fill `rate_limited` clean-exit.
      if (status === 429) {
        log.warn(
          {
            event: 'album_metadata_fill.rate_limited',
            attempted,
            performersUpdated,
            albumsUpserted,
            failed,
          },
          'Spotify rate limit exhausted retries; stopping run with partial progress',
        );
        break;
      }

      // A 401 from the catalog API after `withAppToken`'s fresh-token
      // retry can mean one of two things:
      //  (a) run-wide authorization failure — revoked/restricted
      //      credentials. Every remaining performer would 401 identically,
      //      so we abort and log once rather than emitting one error per
      //      performer (the May 2026 incident logged 1145 `performer_failed`
      //      errors in a single run, tripping error_volume and grinding the
      //      job past its 30-min pg-boss expiry into a `failed` state).
      //  (b) a transient 401 under heavy rate-limiting, after the run has
      //      already succeeded for other performers. Nuking an otherwise
      //      healthy sweep on a single flaky 401 needlessly defers ~1k
      //      performers to the next night.
      // We distinguish them: a 401 is run-wide when nothing has succeeded
      // yet this run, or when several land back-to-back. Otherwise it's a
      // per-performer miss and we keep going.
      if (status === 401) {
        consecutiveAuthFailures += 1;
        const runWide =
          performersUpdated === 0 ||
          consecutiveAuthFailures >= AUTH_ABORT_CONSECUTIVE;
        if (runWide) {
          log.error(
            {
              event: 'album_metadata_fill.auth_rejected',
              err,
              attempted,
              failed,
              consecutiveAuthFailures,
            },
            'app-level token rejected by Spotify catalog API (401); aborting run',
          );
          break;
        }
      } else {
        consecutiveAuthFailures = 0;
      }

      log.error(
        {
          event: 'album_metadata_fill.performer_failed',
          err,
          performerId: performer.id,
          performerName: performer.name,
          status,
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
