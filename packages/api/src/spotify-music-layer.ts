/**
 * Phase 7 of setlist-intelligence — music-layer v2 helpers. Powers the
 * fan-loyalty ring, discovered-live rail, and save-discovered button on
 * the show-detail page.
 *
 * SI-12 decision: we do NOT cache the user's saved library in a local
 * table. Each show view calls Spotify's `/me/tracks/contains` on demand
 * — typical setlist size (15-25 songs) fits comfortably under the
 * 50-IDs-per-call ceiling. To avoid pounding Spotify on tab-flips, the
 * answers are cached in-process for 60s per (userId, trackId) tuple.
 *
 * The two public surfaces (`fanLoyaltyForShow`, `discoveredLiveForShow`)
 * walk the same path:
 *   1. Load the setlist's songs.spotify_track_id where populated.
 *   2. Call `tracksContains` once for the set of resolved IDs.
 *   3. Return the rolled-up answer (ring + rail).
 *
 * Songs without a `spotify_track_id` aren't counted in the totals — we
 * can't know whether they're in the user's library when we can't pin
 * them to a Spotify track id. The Phase 3 resolver job covers most
 * titles; the gap is tolerable for a v1 surface.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  shows,
  songs,
  type Database,
} from '@showbook/db';
import {
  getHeadlinerId,
  normalizePerformerSetlistsMap,
  type ShowLike,
} from '@showbook/shared';
import { child } from '@showbook/observability';
import { ensureFreshUserToken } from './spotify-tokens';
import { tracksContains, saveTracksToLibrary, SpotifyError } from './spotify';

const log = child({ component: 'api.spotify-music-layer', provider: 'spotify' });

const SAVED_CACHE_TTL_MS = 60_000;

interface SavedCacheEntry {
  saved: boolean;
  expiresAt: number;
}

const savedCache = new Map<string, SavedCacheEntry>();

function cacheKey(userId: string, trackId: string): string {
  return `${userId}|${trackId}`;
}

/** Test-only — clears the in-memory cache between cases. */
export function __resetSavedCacheForTests(): void {
  savedCache.clear();
}

interface PartitionedIds {
  cached: Map<string, boolean>;
  toFetch: string[];
}

function partitionByCache(userId: string, trackIds: string[]): PartitionedIds {
  const now = Date.now();
  const cached = new Map<string, boolean>();
  const toFetch: string[] = [];
  for (const id of trackIds) {
    const entry = savedCache.get(cacheKey(userId, id));
    if (entry && entry.expiresAt > now) {
      cached.set(id, entry.saved);
    } else {
      toFetch.push(id);
    }
  }
  return { cached, toFetch };
}

function writeCache(userId: string, trackIds: string[], results: boolean[]): void {
  const expiresAt = Date.now() + SAVED_CACHE_TTL_MS;
  for (let i = 0; i < trackIds.length; i++) {
    savedCache.set(cacheKey(userId, trackIds[i]!), {
      saved: results[i] === true,
      expiresAt,
    });
  }
}

/**
 * Resolve the saved/not-saved status for a set of Spotify track ids,
 * using the 60s per-(user, track) cache to absorb repeat calls. Empty
 * input short-circuits without an HTTP hop.
 *
 * Returns a Map keyed by trackId. Track ids that Spotify drops on
 * the floor (rare — usually means the id is malformed) get a `false`
 * fallback so the caller treats them as "not saved" rather than
 * blowing up.
 */
export async function checkTracksSavedForUser(
  userId: string,
  accessToken: string,
  trackIds: string[],
): Promise<Map<string, boolean>> {
  if (trackIds.length === 0) return new Map();
  const { cached, toFetch } = partitionByCache(userId, trackIds);
  let fetchedResults: boolean[] = [];
  if (toFetch.length > 0) {
    fetchedResults = await tracksContains(accessToken, toFetch);
    writeCache(userId, toFetch, fetchedResults);
  }
  const out = new Map<string, boolean>(cached);
  for (let i = 0; i < toFetch.length; i++) {
    out.set(toFetch[i]!, fetchedResults[i] === true);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Setlist resolution — load the songs we can answer about
// ─────────────────────────────────────────────────────────────────────

export interface ResolvedSetlistSong {
  /** songs.id */
  songId: string;
  title: string;
  /** Spotify track id; null when we don't have a resolved id yet. */
  spotifyTrackId: string | null;
  /** Release year, when known (from songs.firstKnownPerformance) for the rail. */
  year: number | null;
}

interface ShowContext {
  show: typeof shows.$inferSelect;
  headlinerId: string;
  headlinerName: string;
}

async function loadShowContext(
  db: Database,
  userId: string,
  showId: string,
): Promise<ShowContext | null> {
  const show = await db.query.shows.findFirst({
    where: and(eq(shows.id, showId), eq(shows.userId, userId)),
    with: {
      showPerformers: { with: { performer: true } },
    },
  });
  if (!show) return null;
  const headlinerId = getHeadlinerId(show as ShowLike);
  if (!headlinerId) return null;
  const headliner = show.showPerformers.find(
    (sp) => sp.performer.id === headlinerId,
  );
  if (!headliner) return null;
  return {
    show: show as typeof shows.$inferSelect,
    headlinerId,
    headlinerName: headliner.performer.name,
  };
}

/**
 * Walk the show's actual setlist (per-performer map; falls back to the
 * legacy text[] when the new map is empty) and return the per-song
 * rows we can answer about — i.e. those resolved to a Spotify track id
 * via the Phase 3 resolver.
 *
 * Two sources of titles:
 *   - `shows.setlists[headlinerId]` (new shape; populated by Phase 1+)
 *   - `shows.setlist` text[] (legacy; older imports)
 *
 * Title→song resolution is case-insensitive against the `songs` table
 * scoped to the show's headliner.
 */
async function resolveActualSetlistSongs(
  db: Database,
  show: typeof shows.$inferSelect,
  headlinerId: string,
): Promise<ResolvedSetlistSong[]> {
  const titles = new Set<string>();
  const setlistsMap = normalizePerformerSetlistsMap(show.setlists);
  const headlinerSetlist = setlistsMap[headlinerId];
  if (headlinerSetlist) {
    for (const section of headlinerSetlist.sections) {
      for (const song of section.songs) titles.add(song.title.toLowerCase());
    }
  }
  if (titles.size === 0 && Array.isArray(show.setlist)) {
    for (const title of show.setlist) {
      if (typeof title === 'string') titles.add(title.toLowerCase());
    }
  }
  if (titles.size === 0) return [];

  const lowered = Array.from(titles);
  const rows = await db
    .select({
      id: songs.id,
      title: songs.title,
      spotifyTrackId: songs.spotifyTrackId,
      firstKnownPerformance: songs.firstKnownPerformance,
    })
    .from(songs)
    .where(
      and(
        eq(songs.performerId, headlinerId),
        // Match via the same case-folding rule that backs the
        // songs_performer_title_idx unique index. `inArray` against a
        // sql expression keeps the round-trip parameterised.
        inArray(sql`LOWER(${songs.title})`, lowered),
      ),
    );
  // Drop songs whose Spotify id is the negative-cache sentinel (means
  // "we looked and couldn't find one"). We can't ask Spotify about an
  // id we don't have.
  return rows
    .filter(
      (row) =>
        row.spotifyTrackId !== '__none__',
    )
    .map((row) => ({
      songId: row.id,
      title: row.title,
      spotifyTrackId: row.spotifyTrackId,
      year: row.firstKnownPerformance
        ? new Date(row.firstKnownPerformance).getFullYear()
        : null,
    }));
}

// ─────────────────────────────────────────────────────────────────────
// Public — fan loyalty
// ─────────────────────────────────────────────────────────────────────

export interface FanLoyaltyResult {
  /** True when the user has a connected, non-revoked Spotify token. */
  connected: boolean;
  /** True when we can't pin the setlist to Spotify (no resolved ids yet). */
  noData: boolean;
  /**
   * Resolved songs we could ask Spotify about. Equal to the denominator
   * on the ring. May be less than the played-track count when songs
   * lack a Spotify track id.
   */
  totalCount: number;
  /** Songs in the resolved set that were already in the user's library. */
  savedCount: number;
  /** Headliner name — display in the ring's label block. */
  artistName: string;
  /** Total played songs (denominator the user *sees* in the spec copy). */
  playedCount: number;
}

export async function fanLoyaltyForShow(opts: {
  db: Database;
  userId: string;
  showId: string;
}): Promise<FanLoyaltyResult> {
  const ctx = await loadShowContext(opts.db, opts.userId, opts.showId);
  if (!ctx) {
    return emptyLoyalty();
  }
  const resolved = await resolveActualSetlistSongs(opts.db, ctx.show, ctx.headlinerId);
  const playedCount = await countActualPlayed(opts.db, ctx.show, ctx.headlinerId);
  const idMatchedSongs = resolved.filter((r) => Boolean(r.spotifyTrackId));
  if (idMatchedSongs.length === 0) {
    return {
      connected: await hasConnection(opts.userId),
      noData: true,
      totalCount: 0,
      savedCount: 0,
      artistName: ctx.headlinerName,
      playedCount,
    };
  }
  const accessToken = await ensureFreshUserToken(opts.userId);
  if (!accessToken) {
    return {
      connected: false,
      noData: false,
      totalCount: idMatchedSongs.length,
      savedCount: 0,
      artistName: ctx.headlinerName,
      playedCount,
    };
  }
  const ids = idMatchedSongs.map((r) => r.spotifyTrackId!) as string[];
  const saved = await checkTracksSavedForUser(opts.userId, accessToken, ids);
  let savedCount = 0;
  for (const id of ids) if (saved.get(id)) savedCount += 1;
  log.info(
    {
      event: 'setlistIntel.fan_loyalty.computed',
      userId: opts.userId,
      showId: opts.showId,
      played: playedCount,
      resolved: idMatchedSongs.length,
      saved: savedCount,
    },
    'Fan loyalty computed',
  );
  return {
    connected: true,
    noData: false,
    totalCount: idMatchedSongs.length,
    savedCount,
    artistName: ctx.headlinerName,
    playedCount,
  };
}

function emptyLoyalty(): FanLoyaltyResult {
  return {
    connected: false,
    noData: true,
    totalCount: 0,
    savedCount: 0,
    artistName: '',
    playedCount: 0,
  };
}

async function hasConnection(userId: string): Promise<boolean> {
  // Cheap helper — re-use ensureFreshUserToken result without
  // surfacing the access token to the caller.
  const t = await ensureFreshUserToken(userId);
  return Boolean(t);
}

async function countActualPlayed(
  db: Database,
  show: typeof shows.$inferSelect,
  headlinerId: string,
): Promise<number> {
  const setlistsMap = normalizePerformerSetlistsMap(show.setlists);
  const headlinerSetlist = setlistsMap[headlinerId];
  if (headlinerSetlist) {
    let n = 0;
    for (const section of headlinerSetlist.sections) n += section.songs.length;
    return n;
  }
  return Array.isArray(show.setlist) ? show.setlist.length : 0;
}

// ─────────────────────────────────────────────────────────────────────
// Public — discovered-live rail
// ─────────────────────────────────────────────────────────────────────

export interface DiscoveredTrack {
  songId: string;
  title: string;
  artistName: string;
  year: number | null;
  spotifyTrackId: string;
  saved: boolean;
}

export interface DiscoveredLiveResult {
  connected: boolean;
  /** True when no setlist songs resolved to Spotify ids. */
  noData: boolean;
  tracks: DiscoveredTrack[];
}

export async function discoveredLiveForShow(opts: {
  db: Database;
  userId: string;
  showId: string;
}): Promise<DiscoveredLiveResult> {
  const ctx = await loadShowContext(opts.db, opts.userId, opts.showId);
  if (!ctx) {
    return { connected: false, noData: true, tracks: [] };
  }
  const resolved = await resolveActualSetlistSongs(opts.db, ctx.show, ctx.headlinerId);
  const idMatchedSongs = resolved.filter((r) => Boolean(r.spotifyTrackId));
  if (idMatchedSongs.length === 0) {
    return {
      connected: await hasConnection(opts.userId),
      noData: true,
      tracks: [],
    };
  }
  const accessToken = await ensureFreshUserToken(opts.userId);
  if (!accessToken) {
    return { connected: false, noData: false, tracks: [] };
  }
  const ids = idMatchedSongs.map((r) => r.spotifyTrackId!) as string[];
  const saved = await checkTracksSavedForUser(opts.userId, accessToken, ids);

  const tracks: DiscoveredTrack[] = idMatchedSongs.map((r) => ({
    songId: r.songId,
    title: r.title,
    artistName: ctx.headlinerName,
    year: r.year,
    spotifyTrackId: r.spotifyTrackId!,
    saved: saved.get(r.spotifyTrackId!) === true,
  }));

  return { connected: true, noData: false, tracks };
}

// ─────────────────────────────────────────────────────────────────────
// Public — save discovered song
// ─────────────────────────────────────────────────────────────────────

export interface SaveDiscoveredResult {
  ok: boolean;
  /** Why the save failed when `ok` is false. */
  reason?: 'not_connected' | 'no_spotify_id' | 'spotify_error';
}

/**
 * Save a single song (by Showbook songs.id) to the user's Spotify
 * library. The mutation invalidates the per-(user, trackId) cache so
 * the next fan-loyalty/discovered-live render reflects the new state.
 */
export async function saveDiscoveredSong(opts: {
  db: Database;
  userId: string;
  songId: string;
}): Promise<SaveDiscoveredResult> {
  const [row] = await opts.db
    .select({
      spotifyTrackId: songs.spotifyTrackId,
    })
    .from(songs)
    .where(eq(songs.id, opts.songId))
    .limit(1);
  if (!row?.spotifyTrackId || row.spotifyTrackId === '__none__') {
    return { ok: false, reason: 'no_spotify_id' };
  }
  const accessToken = await ensureFreshUserToken(opts.userId);
  if (!accessToken) {
    return { ok: false, reason: 'not_connected' };
  }
  try {
    await saveTracksToLibrary(accessToken, [row.spotifyTrackId]);
  } catch (err) {
    log.error(
      {
        event: 'setlistIntel.save_discovered.failed',
        err,
        userId: opts.userId,
        songId: opts.songId,
      },
      'Save-discovered failed',
    );
    if (err instanceof SpotifyError) {
      return { ok: false, reason: 'spotify_error' };
    }
    throw err;
  }
  // Optimistic cache patch so the next render reflects the new state
  // without waiting for the 60s TTL.
  savedCache.set(cacheKey(opts.userId, row.spotifyTrackId), {
    saved: true,
    expiresAt: Date.now() + SAVED_CACHE_TTL_MS,
  });
  log.info(
    {
      event: 'setlistIntel.save_discovered.ok',
      userId: opts.userId,
      songId: opts.songId,
    },
    'Save-discovered succeeded',
  );
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────
// Public — priming stat
// ─────────────────────────────────────────────────────────────────────

export interface PrimingStatResult {
  /** Number of (user, performer) plays within 24h before the show. */
  prepCount: number | null;
  /** Number of (user, performer) plays within 24h after the show. */
  postCount: number | null;
}

/**
 * Read the priming counts populated by the nightly
 * `spotify/recently-played` job. Returns nulls when the job hasn't yet
 * filled the show (typical: <6h post-show).
 */
export async function primingStatForShow(opts: {
  db: Database;
  userId: string;
  showId: string;
}): Promise<PrimingStatResult> {
  const [row] = await opts.db
    .select({
      spotifyPrepTrackCount: shows.spotifyPrepTrackCount,
      spotifyPostTrackCount: shows.spotifyPostTrackCount,
    })
    .from(shows)
    .where(and(eq(shows.id, opts.showId), eq(shows.userId, opts.userId)))
    .limit(1);
  return {
    prepCount: row?.spotifyPrepTrackCount ?? null,
    postCount: row?.spotifyPostTrackCount ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Export referenced symbols for the test suite
// ─────────────────────────────────────────────────────────────────────

export const __internal = {
  resolveActualSetlistSongs,
};
