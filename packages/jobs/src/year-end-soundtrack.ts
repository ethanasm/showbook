/**
 * Phase 7 — annual year-end soundtrack generation. Runs Dec 31 at
 * 03:00 ET. For each user with a non-revoked Spotify token, builds a
 * playlist of one signature track per show attended in the year and
 * upserts it on the user's Spotify account.
 *
 * Idempotency: `users.spotify_year_playlists` carries
 * `{ [year]: spotifyPlaylistId }`. A re-run for the same year
 * overwrites the existing playlist's items via `replacePlaylistItems`
 * rather than creating a duplicate. First-run inserts a fresh
 * playlist and records its id.
 *
 * Signature-track scorer:
 *   score = playedCount × spotifyPopularity × userListeningFrequency
 *   playedCount      = times the song was played in setlists this year
 *   spotifyPopularity = songs.spotify_popularity (when present) else 50
 *   listening        = +2 if the song is in the user's top tracks
 *                      (boost rather than multiplier so a zero doesn't
 *                       drop the track from the running)
 *
 * Ordering: rough warm-up → peak → wind-down — we score by popularity
 * and then arrange so high-popularity tracks land mid-playlist with
 * lower-popularity bookends. (DJ-set heuristic, not a real valence/
 * energy curve until Phase 8 ships audio features.)
 */

import './load-env-local';

import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import {
  db,
  performers,
  setlistSongAppearances,
  shows,
  songs,
  userSpotifyTokens,
  users,
} from '@showbook/db';
import {
  addTracksToPlaylist,
  createPlaylist,
  ensureFreshUserToken,
  getTopTracks,
  replacePlaylistItems,
  SpotifyError,
} from '@showbook/api';
import { child } from '@showbook/observability';

const log = child({ component: 'jobs.year-end-soundtrack' });

export interface YearEndSoundtrackSummary {
  attempted: number;
  built: number;
  reused: number;
  skipped: number;
  failed: number;
  year: number;
}

interface RunOptions {
  /** Force a specific year (defaults to current). */
  year?: number;
  /** Limit to a single user id (for the CLI + tests). */
  userId?: string;
}

interface CandidateSong {
  songId: string;
  spotifyTrackId: string;
  popularity: number;
  performerId: string;
  performerName: string;
  playedCount: number;
}

export async function runYearEndSoundtrack(
  opts: RunOptions = {},
): Promise<YearEndSoundtrackSummary> {
  const year = opts.year ?? new Date().getFullYear();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  const userRows = await db
    .select({
      userId: userSpotifyTokens.userId,
    })
    .from(userSpotifyTokens)
    .where(
      opts.userId
        ? and(
            eq(userSpotifyTokens.userId, opts.userId),
            isNull(userSpotifyTokens.revokedAt),
          )
        : isNull(userSpotifyTokens.revokedAt),
    );

  let built = 0;
  let reused = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of userRows) {
    try {
      const result = await runForUser({
        userId: row.userId,
        year,
        start,
        end,
      });
      if (result.outcome === 'built') built += 1;
      else if (result.outcome === 'reused') reused += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      log.error(
        { event: 'year_end_soundtrack.failed', err, userId: row.userId, year },
        'Year-end soundtrack failed',
      );
    }
  }
  log.info(
    {
      event: 'year_end_soundtrack.summary',
      attempted: userRows.length,
      built,
      reused,
      skipped,
      failed,
      year,
    },
    'Year-end soundtrack sweep complete',
  );
  return {
    attempted: userRows.length,
    built,
    reused,
    skipped,
    failed,
    year,
  };
}

interface RunForUserInput {
  userId: string;
  year: number;
  start: string;
  end: string;
}

interface RunForUserResult {
  outcome: 'built' | 'reused' | 'skipped';
  playlistId?: string;
  trackCount?: number;
}

async function runForUser(input: RunForUserInput): Promise<RunForUserResult> {
  const accessToken = await ensureFreshUserToken(input.userId);
  if (!accessToken) {
    log.info(
      { event: 'year_end_soundtrack.no_token', userId: input.userId },
      'No active Spotify connection — skipping',
    );
    return { outcome: 'skipped' };
  }

  // Pull the user's top tracks once — used by the scorer below to
  // boost personally-loved songs.
  let topIds = new Set<string>();
  try {
    const top = await getTopTracks(accessToken);
    topIds = new Set(top.map((t) => t.id));
  } catch (err) {
    log.warn(
      { event: 'year_end_soundtrack.top_tracks_failed', err, userId: input.userId },
      'top-tracks pull failed; falling back to popularity-only scoring',
    );
  }

  const candidates = await loadCandidateSongs(input);
  if (candidates.length === 0) {
    log.info(
      { event: 'year_end_soundtrack.no_candidates', userId: input.userId, year: input.year },
      'No resolvable songs this year — skipping',
    );
    return { outcome: 'skipped' };
  }

  const signature = pickSignatureTracks(candidates, topIds);
  const ordered = djSetOrder(signature);

  const uris = ordered.map((c) => `spotify:track:${c.spotifyTrackId}`);

  // Look up existing year-playlist id.
  const [existingUser] = await db
    .select({ map: users.spotifyYearPlaylists })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const yearKey = String(input.year);
  const existingPlaylistId = existingUser?.map?.[yearKey] ?? null;

  if (existingPlaylistId) {
    try {
      await replacePlaylistItems(accessToken, existingPlaylistId, uris);
    } catch (err) {
      if (err instanceof SpotifyError && err.status === 404) {
        log.warn(
          {
            event: 'year_end_soundtrack.existing_404',
            userId: input.userId,
            playlistId: existingPlaylistId,
          },
          'Existing playlist no longer on Spotify; will re-create',
        );
        return buildFresh({ accessToken, input, uris, yearKey });
      }
      throw err;
    }
    log.info(
      {
        event: 'year_end_soundtrack.built',
        outcome: 'reused',
        userId: input.userId,
        playlistId: existingPlaylistId,
        year: input.year,
        trackCount: uris.length,
      },
      'Year-end soundtrack re-used existing playlist',
    );
    return { outcome: 'reused', playlistId: existingPlaylistId, trackCount: uris.length };
  }

  return buildFresh({ accessToken, input, uris, yearKey });
}

async function buildFresh(args: {
  accessToken: string;
  input: RunForUserInput;
  uris: string[];
  yearKey: string;
}): Promise<RunForUserResult> {
  const { accessToken, input, uris, yearKey } = args;
  const playlist = await createPlaylist(accessToken, {
    name: `Showbook · ${input.year}`,
    description: `Your ${input.year} in concerts. One signature track per show, ordered DJ-set style.`,
    isPublic: false,
  });
  for (let offset = 0; offset < uris.length; offset += 100) {
    const batch = uris.slice(offset, offset + 100);
    await addTracksToPlaylist(
      accessToken,
      playlist.id,
      batch,
      offset === 0 ? undefined : offset,
    );
  }
  // Persist the playlist id back onto the user row.
  await db
    .update(users)
    .set({
      spotifyYearPlaylists: sql`
        COALESCE(${users.spotifyYearPlaylists}, '{}'::jsonb)
        || jsonb_build_object(${yearKey}, ${playlist.id}::text)
      `,
    })
    .where(eq(users.id, input.userId));
  log.info(
    {
      event: 'year_end_soundtrack.built',
      outcome: 'fresh',
      userId: input.userId,
      playlistId: playlist.id,
      year: input.year,
      trackCount: uris.length,
    },
    'Year-end soundtrack playlist built',
  );
  return { outcome: 'built', playlistId: playlist.id, trackCount: uris.length };
}

// ─────────────────────────────────────────────────────────────────────
// Scoring + ordering
// ─────────────────────────────────────────────────────────────────────

async function loadCandidateSongs(
  input: RunForUserInput,
): Promise<CandidateSong[]> {
  // For each (showId attended this year, headliner performer), pick the
  // songs that were played and have a resolved Spotify track id. We
  // pick the signature track per *show*, so we group by showId
  // downstream.
  const rows = await db
    .select({
      showId: setlistSongAppearances.showId,
      songId: setlistSongAppearances.songId,
      spotifyTrackId: songs.spotifyTrackId,
      title: songs.title,
      performerId: setlistSongAppearances.performerId,
      performerName: performers.name,
      performanceDate: setlistSongAppearances.performanceDate,
    })
    .from(setlistSongAppearances)
    .innerJoin(shows, eq(shows.id, setlistSongAppearances.showId))
    .innerJoin(songs, eq(songs.id, setlistSongAppearances.songId))
    .innerJoin(performers, eq(performers.id, setlistSongAppearances.performerId))
    .where(
      and(
        eq(shows.userId, input.userId),
        eq(shows.state, 'past'),
        gte(shows.date, input.start),
        lte(shows.date, input.end),
      ),
    );

  // Per-show pick. Without a real Spotify popularity column on songs
  // yet (Phase 7 doesn't add one — Phase 11 / catalog metadata
  // does), we proxy popularity from how often the song shows up in
  // the user's setlist corpus.
  const perShow = new Map<string, CandidateSong[]>();
  const playedCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.spotifyTrackId || row.spotifyTrackId === '__none__') continue;
    if (!row.showId) continue;
    playedCounts.set(row.songId, (playedCounts.get(row.songId) ?? 0) + 1);
    const list = perShow.get(row.showId) ?? [];
    list.push({
      songId: row.songId,
      spotifyTrackId: row.spotifyTrackId,
      popularity: 50, // backfilled by getTopTracks boost below
      performerId: row.performerId,
      performerName: row.performerName,
      playedCount: 0, // patched after we have the full corpus
    });
    perShow.set(row.showId, list);
  }
  const picks: CandidateSong[] = [];
  for (const list of perShow.values()) {
    if (list.length === 0) continue;
    for (const candidate of list) {
      candidate.playedCount = playedCounts.get(candidate.songId) ?? 1;
    }
    list.sort((a, b) => b.playedCount - a.playedCount);
    picks.push(list[0]!);
  }
  return picks;
}

export function pickSignatureTracks(
  candidates: CandidateSong[],
  topIds: Set<string>,
): CandidateSong[] {
  // Deduplicate by spotifyTrackId — if the same signature track wins
  // for two different shows, only the highest-scored one survives.
  const byId = new Map<string, CandidateSong>();
  for (const c of candidates) {
    const boost = topIds.has(c.spotifyTrackId) ? 2 : 1;
    const score = c.playedCount * c.popularity * boost;
    const existing = byId.get(c.spotifyTrackId);
    if (!existing || score > existing.popularity) {
      byId.set(c.spotifyTrackId, { ...c, popularity: score });
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => b.popularity - a.popularity,
  );
}

/**
 * DJ-set order: warm-up → peak → wind-down. Achieved by splitting the
 * popularity-sorted array into two halves and arranging the higher
 * scores toward the middle. Quieter tracks bookend the playlist.
 *
 * Input is sorted descending by score (highest first); output places
 * the highest near the centre with descending strength outward.
 */
export function djSetOrder(sorted: CandidateSong[]): CandidateSong[] {
  if (sorted.length <= 2) return sorted;
  const left: CandidateSong[] = [];
  const right: CandidateSong[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i % 2 === 0) left.push(sorted[i]!);
    else right.push(sorted[i]!);
  }
  // `left` holds every other entry starting from the highest score
  // (descending strength); reversing flips it to ascending strength so
  // the playlist warms up into the centre peak.
  left.reverse();
  return [...left, ...right];
}
