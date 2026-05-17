/**
 * Phase 11 §15j — personal-weight chips for predicted-setlist rows.
 *
 * Three chip types per row:
 *   💛 saved      — song's Spotify track id is in the user's library
 *                   (`/me/tracks/contains`, cached via Phase 7's
 *                   `checkTracksSavedForUser`)
 *   🎯 first_time — user hasn't heard the song live in any prior
 *                   attended show (`setlist_song_appearances`)
 *   ⭐ top_track  — song is in the user's Spotify long-term top 50
 *                   (`/me/top/tracks?time_range=long_term`)
 *
 * Top-tracks data is NOT persisted to the database — see the Phase 11
 * plan's "Top-tracks data" decision. We call `/me/top/tracks` on
 * demand and cache the result in a module-level in-memory LRU
 * keyed by userId, 24-hour TTL. The cache warms fresh on every Next.js
 * process restart; for a single-user app this is acceptable since the
 * first call after a deploy adds ~150ms to one tab load.
 *
 * The "songs you'd want to hear" rail filters predicted songs to
 * those carrying ≥1 chip — see `apps/web/components/show-tabs/
 * SongsYoudWantToHearRail.tsx`.
 */

import { and, eq, inArray } from 'drizzle-orm';
import {
  db,
  setlistSongAppearances,
  shows,
  songs,
} from '@showbook/db';
import { child } from '@showbook/observability';
import { getTopTracks, SpotifyError } from './spotify';
import { ensureFreshUserToken } from './spotify-tokens';
import { checkTracksSavedForUser } from './spotify-music-layer';

const log = child({ component: 'api.personal-chips' });

const TOP_TRACKS_TTL_MS = 24 * 60 * 60 * 1000;
const TOP_TRACKS_LIMIT = 50;

/** Module-level LRU. Lives until the Next.js process restarts. */
const topTracksCache = new Map<
  string,
  { trackIds: Set<string>; expiresAt: number }
>();

export interface PersonalChipSet {
  /** Lower-case song titles that match each chip — the predicted-row
   *  consumer looks up by `song.title.toLowerCase()`. */
  saved: Set<string>;
  firstTime: Set<string>;
  topTrack: Set<string>;
}

interface ResolveOpts {
  userId: string;
  performerId: string;
  /** Predicted song titles (raw — case-preserving). The resolver
   *  lowercases before lookup. */
  predictedTitles: string[];
}

/**
 * Resolve the chip set for a predicted setlist. Each chip's lookup
 * tolerates failure independently — Spotify can be down for the saved
 * + top-tracks branches without blocking the first-time chip (which
 * needs only the local DB).
 */
export async function resolvePersonalChips(
  opts: ResolveOpts,
): Promise<PersonalChipSet> {
  const empty: PersonalChipSet = {
    saved: new Set(),
    firstTime: new Set(),
    topTrack: new Set(),
  };
  if (opts.predictedTitles.length === 0) return empty;

  const lowerTitles = opts.predictedTitles.map((t) => t.trim().toLowerCase());
  const titleLowerSet = new Set(lowerTitles);

  // Resolve song rows for the performer matching any predicted title
  // (lower-cased compare).
  const songRows = await db
    .select({
      id: songs.id,
      title: songs.title,
      spotifyTrackId: songs.spotifyTrackId,
    })
    .from(songs)
    .where(eq(songs.performerId, opts.performerId));

  const matched = songRows.filter((s) =>
    titleLowerSet.has(s.title.trim().toLowerCase()),
  );

  const trackIds = matched
    .map((s) => s.spotifyTrackId)
    .filter((id): id is string => !!id);

  // 🎯 first_time — songs the user has NOT yet heard in any prior
  // attended show. Single indexed query against
  // setlist_song_appearances joined to user's shows.
  const songIds = matched.map((s) => s.id);
  const firstTime = new Set<string>();
  if (songIds.length > 0) {
    const heard = await db
      .selectDistinct({ songId: setlistSongAppearances.songId })
      .from(setlistSongAppearances)
      .innerJoin(shows, eq(shows.id, setlistSongAppearances.showId))
      .where(
        and(
          eq(shows.userId, opts.userId),
          eq(shows.state, 'past'),
          inArray(setlistSongAppearances.songId, songIds),
        ),
      );
    const heardSongIds = new Set(heard.map((h) => h.songId));
    for (const s of matched) {
      if (!heardSongIds.has(s.id)) {
        firstTime.add(s.title.trim().toLowerCase());
      }
    }
  }

  // 💛 saved + ⭐ top_track both rely on a fresh user token. Skip
  // both gracefully if the user hasn't connected Spotify.
  let saved = new Set<string>();
  let topTrack = new Set<string>();
  if (trackIds.length > 0) {
    let accessToken: string | null = null;
    try {
      accessToken = await ensureFreshUserToken(opts.userId);
    } catch {
      // No token / revoked — skip Spotify-derived chips.
    }
    if (accessToken) {
      try {
        const savedMap = await checkTracksSavedForUser(
          opts.userId,
          accessToken,
          trackIds,
        );
        for (const s of matched) {
          if (s.spotifyTrackId && savedMap.get(s.spotifyTrackId)) {
            saved.add(s.title.trim().toLowerCase());
          }
        }
      } catch (err) {
        log.warn(
          { event: 'personal_chips.saved_failed', err, userId: opts.userId },
          'saved-tracks lookup failed; chip omitted',
        );
      }

      try {
        const topTrackIds = await loadTopTrackIds(opts.userId, accessToken);
        for (const s of matched) {
          if (s.spotifyTrackId && topTrackIds.has(s.spotifyTrackId)) {
            topTrack.add(s.title.trim().toLowerCase());
          }
        }
      } catch (err) {
        if (err instanceof SpotifyError && err.status === 403) {
          log.warn(
            { event: 'personal_chips.top_tracks_forbidden', userId: opts.userId },
            'top-tracks scope missing or revoked',
          );
        } else {
          log.warn(
            { event: 'personal_chips.top_tracks_failed', err, userId: opts.userId },
            'top-tracks lookup failed; chip omitted',
          );
        }
      }
    }
  }

  return { saved, firstTime, topTrack };
}

/**
 * Look up the user's long-term top-50 tracks, cached for 24 hours in
 * an in-memory module-level map. The cache is intentionally NOT
 * persisted to the database — see the Phase 11 plan's "Top-tracks
 * data" decision.
 */
async function loadTopTrackIds(
  userId: string,
  accessToken: string,
): Promise<Set<string>> {
  const now = Date.now();
  const cached = topTracksCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.trackIds;
  }
  const top = await getTopTracks(accessToken, {
    timeRange: 'long_term',
    limit: TOP_TRACKS_LIMIT,
  });
  const trackIds = new Set(top.map((t) => t.id));
  topTracksCache.set(userId, {
    trackIds,
    expiresAt: now + TOP_TRACKS_TTL_MS,
  });
  return trackIds;
}

/** Test-only — clears the in-memory cache so each integration test
 *  starts fresh. Not exported through the package index. */
export function __resetTopTracksCacheForTests(): void {
  topTracksCache.clear();
}
