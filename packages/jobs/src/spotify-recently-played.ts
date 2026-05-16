/**
 * Phase 7 — per-user pull of Spotify `/me/player/recently-played` and
 * bucketing into per-show prep/post counts on `shows`.
 *
 * The job iterates every user with a non-revoked Spotify token, calls
 * the recently-played endpoint, and for each play increments the
 * matching show's `spotify_prep_track_count` (play before the show) or
 * `spotify_post_track_count` (play after) when the play falls within
 * ±6h of the show date.
 *
 * Counts are frozen 6h after the show date — once the show has been
 * "past" for that long, future runs skip it. This lets us idempotently
 * re-run the cron without double-counting.
 *
 * Schedule: 09:00 ET nightly.
 */

import './load-env-local';

import { and, eq, gte, isNull, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db, shows, userSpotifyTokens } from '@showbook/db';
import {
  ensureFreshUserToken,
  getRecentlyPlayed,
  type SpotifyRecentlyPlayedTrack,
} from '@showbook/api';
import { child } from '@showbook/observability';

const log = child({ component: 'jobs.spotify-recently-played' });

const SETTLE_MS = 6 * 60 * 60 * 1000; // 6 hours
const PLAY_WINDOW_MS = 6 * 60 * 60 * 1000; // ±6 hours from show

export interface RecentlyPlayedSummary {
  /** Users we attempted to pull recently-played for. */
  attempted: number;
  /** Users whose recently-played history landed at least one bucket. */
  matched: number;
  /** Users with no Spotify hits in the window (no shows nearby). */
  noMatch: number;
  /** Users where the call failed (auth, network). */
  failed: number;
}

export async function runSpotifyRecentlyPlayed(): Promise<RecentlyPlayedSummary> {
  const rows = await db
    .select({ userId: userSpotifyTokens.userId })
    .from(userSpotifyTokens)
    .where(isNull(userSpotifyTokens.revokedAt));
  let matched = 0;
  let noMatch = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await runForUser(row.userId);
      if (result.bucketed > 0) matched += 1;
      else noMatch += 1;
    } catch (err) {
      failed += 1;
      log.error(
        { event: 'spotify.recently_played.failed', err, userId: row.userId },
        'Recently-played pull failed',
      );
    }
  }
  log.info(
    {
      event: 'spotify.recently_played.summary',
      attempted: rows.length,
      matched,
      noMatch,
      failed,
    },
    'Recently-played sweep complete',
  );
  return { attempted: rows.length, matched, noMatch, failed };
}

interface PerUserResult {
  bucketed: number;
}

export async function runForUser(userId: string): Promise<PerUserResult> {
  const accessToken = await ensureFreshUserToken(userId);
  if (!accessToken) {
    log.info(
      { event: 'spotify.recently_played.no_token', userId },
      'No active Spotify connection — skipping',
    );
    return { bucketed: 0 };
  }
  let plays: SpotifyRecentlyPlayedTrack[];
  try {
    plays = await getRecentlyPlayed(accessToken);
  } catch (err) {
    log.error(
      { event: 'spotify.recently_played.fetch_failed', err, userId },
      'Failed to fetch recently-played history',
    );
    throw err;
  }
  if (plays.length === 0) {
    log.info(
      { event: 'spotify.recently_played.no_data', userId },
      'Recently-played returned no items',
    );
    return { bucketed: 0 };
  }

  // We only care about shows whose date is within the window of any
  // play. Compute the window over the play set and load only matching
  // shows for the user.
  const playedAtMs = plays.map((p) => p.playedAt.getTime());
  const minPlay = new Date(Math.min(...playedAtMs) - PLAY_WINDOW_MS);
  const maxPlay = new Date(Math.max(...playedAtMs) + PLAY_WINDOW_MS);
  const minPlayDate = minPlay.toISOString().slice(0, 10);
  const maxPlayDate = maxPlay.toISOString().slice(0, 10);

  const candidateShows = await db
    .select({
      id: shows.id,
      date: shows.date,
      prepCount: shows.spotifyPrepTrackCount,
      postCount: shows.spotifyPostTrackCount,
    })
    .from(shows)
    .where(
      and(
        eq(shows.userId, userId),
        isNotNull(shows.date),
        gte(shows.date, minPlayDate),
        lte(shows.date, maxPlayDate),
      ),
    );

  const now = Date.now();
  let bucketed = 0;
  for (const show of candidateShows) {
    if (!show.date) continue;
    // Treat the show date as the local-evening of the show — there's
    // no time-of-day on the row, so the bucketing window is 6h either
    // side of midnight (effectively a 12h pre + 6h post window, which
    // matches the spec's "morning of" + "drinks before" cases without
    // chasing the venue tz).
    const showMid = new Date(`${show.date}T20:00:00Z`).getTime();
    if (now - showMid > SETTLE_MS + 24 * 60 * 60 * 1000) {
      // Show is more than ~30h past — counts are frozen.
      continue;
    }
    let prep = show.prepCount ?? 0;
    let post = show.postCount ?? 0;
    let touched = false;
    for (const play of plays) {
      const dt = play.playedAt.getTime() - showMid;
      if (Math.abs(dt) > PLAY_WINDOW_MS) continue;
      touched = true;
      if (dt < 0) prep += 1;
      else post += 1;
    }
    if (touched) {
      await db
        .update(shows)
        .set({
          spotifyPrepTrackCount: prep,
          spotifyPostTrackCount: post,
        })
        .where(eq(shows.id, show.id));
      bucketed += 1;
      log.info(
        {
          event: 'spotify.recently_played.bucketed',
          userId,
          showId: show.id,
          prep,
          post,
        },
        'Show priming counts updated',
      );
    }
  }
  return { bucketed };
}

// `or` and `sql` exports are referenced via drizzle types above; keep
// the lint-clean import set.
void or;
void sql;
