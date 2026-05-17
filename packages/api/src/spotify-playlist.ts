/**
 * Phase 3 of setlist-intelligence — Spotify hype/heard playlist
 * orchestration. The single source of truth for turning a (predicted
 * or actual) setlist into a real, idempotent Spotify playlist row.
 *
 * Public surface:
 *   - `createHypePlaylist({ userId, showId })` — pre-show, uses
 *     predicted setlist
 *   - `createHeardPlaylist({ userId, showId })` — post-show, uses
 *     actual setlist
 *   - `getExistingPlaylist({ userId, showId, kind })` — idempotency
 *     check (also used by the UI when the row already exists)
 *   - `buildPlaylistName` / `buildPlaylistDescription` — exported for
 *     unit tests
 *   - `resolveTrackUris` — exported for unit tests
 *
 * Caching: the per-(artist, title) lookup is 24h in-memory. The cache
 * is process-local on purpose — the Spotify search API has soft per-app
 * rate limits, so re-resolving the same setlist across many
 * concurrent users is cheap. A future SI-11 / Phase 3 background job
 * will persist resolutions to `songs.spotify_track_id`; this module
 * already consults that column on the way in and short-circuits when
 * a song already has a non-sentinel id.
 *
 * Ordering: tracks are appended to the playlist in the same order as
 * the source setlist (openers → core → closers → encore). Spotify
 * supports a `position` param on the add-tracks endpoint, used for
 * multi-batch (>100 tracks).
 */

import { and, eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { child, withTrace } from '@showbook/observability';
import {
  db,
  performers,
  shows,
  showPerformers,
  showSpotifyPlaylists,
  songs,
  userSpotifyTokens,
  type Database,
} from '@showbook/db';
import {
  getHeadlinerId,
  isProductionShow,
  type ShowLike,
} from '@showbook/shared';
import { ensureFreshUserToken } from './spotify-tokens';
import {
  addTracksToPlaylist,
  createPlaylist,
  diffScopes,
  HYPE_PLAYLIST_SCOPES,
  searchTrack,
  SpotifyError,
  type SpotifyTrack,
} from './spotify';
import {
  predictedSetlistCached,
  type HotPrediction,
} from './setlist-predict';
import {
  normalizePerformerSetlistsMap,
  setlistTotalSongs,
  type PerformerSetlist,
} from '@showbook/shared';

const log = child({ component: 'api.spotify-playlist', provider: 'spotify' });

const TRACK_RESOLVE_TTL_MS = 24 * 60 * 60 * 1000;
const SPOTIFY_NEGATIVE_SENTINEL = '__none__';

interface CacheEntry {
  track: SpotifyTrack | null;
  expiresAt: number;
}

// Module-scoped Map. Per-process — workers don't share, but a single Next.js
// instance handles all hype-playlist calls for a given app server, so the
// hit rate within a window is high enough to skip the Spotify hop on
// repeat lookups.
const trackResolveCache = new Map<string, CacheEntry>();

function cacheKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
}

/** Test-only — clears the in-memory cache between cases. */
export function __resetTrackResolveCacheForTests(): void {
  trackResolveCache.clear();
}

export type PlaylistKind = 'hype' | 'heard';

export interface SetlistTrack {
  /** Display title — used for the Spotify search query. */
  title: string;
  /**
   * Optional songs.id when we already have a row. Lets us short-circuit
   * the search when `songs.spotify_track_id` is populated.
   */
  songId?: string | null;
}

export interface PlaylistMetadata {
  artistName: string;
  venueName: string;
  date: string;
  confidence: number | null; // null for heard variant
}

export interface PlaylistResolution {
  uris: string[];
  durationMs: number;
  resolved: number;
  requested: number;
  missing: string[];
  hits: number;
  misses: number;
}

export interface CreatePlaylistResult {
  playlistId: string;
  spotifyUrl: string;
  trackCount: number;
  durationMs: number;
  requested: number;
  missing: string[];
  reused: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Name + description templates
// ─────────────────────────────────────────────────────────────────────

/**
 * Spotify playlist name. Bounded at 100 chars (Spotify limit). The
 * `kind` flips the prefix only — the suffix is identical so the user
 * can scan their playlist list and recognise both variants from the
 * same show.
 */
export function buildPlaylistName(
  kind: PlaylistKind,
  meta: PlaylistMetadata,
): string {
  const prefix = kind === 'hype' ? 'Hype' : 'I Heard';
  const raw = `${prefix}: ${meta.artistName} @ ${meta.venueName} · ${meta.date}`;
  if (raw.length <= 100) return raw;
  // Trim from the artist+venue middle, keep date + prefix legible.
  return raw.slice(0, 97) + '…';
}

export function buildPlaylistDescription(
  kind: PlaylistKind,
  meta: PlaylistMetadata,
): string {
  if (kind === 'hype') {
    const pct = meta.confidence != null ? Math.round(meta.confidence * 100) : null;
    const confidenceSegment =
      pct != null ? `a ${pct}% setlist prediction` : 'a setlist prediction';
    return `Auto-generated by Showbook from ${confidenceSegment}. Tracks may shuffle live.`;
  }
  return `Auto-generated by Showbook from the setlist played at ${meta.venueName} on ${meta.date}.`;
}

// ─────────────────────────────────────────────────────────────────────
// Track URI resolution (with 24h in-memory cache)
// ─────────────────────────────────────────────────────────────────────

/**
 * Turn `tracks` (in setlist order) into a parallel array of Spotify
 * URIs, dropping nulls but recording missing titles. Resolves in
 * source order so the cache hit-rate is high for batches of similar
 * setlists and so the eventual playlist mirrors the source ordering
 * exactly (openers first, encore last).
 */
export async function resolveTrackUris(
  accessToken: string,
  artist: string,
  tracks: SetlistTrack[],
): Promise<PlaylistResolution> {
  const uris: string[] = [];
  const missing: string[] = [];
  let durationMs = 0;
  let hits = 0;
  let misses = 0;

  // Pre-load any songs that already have a Spotify track id on the
  // catalog row — saves the search hop entirely for performers we've
  // already resolved once.
  const songIds = tracks
    .map((t) => t.songId)
    .filter((id): id is string => Boolean(id));
  const songRows = songIds.length
    ? await db
        .select({ id: songs.id, spotifyTrackId: songs.spotifyTrackId, durationMs: songs.durationMs })
        .from(songs)
        .where(inArray(songs.id, songIds))
    : [];
  const songLookup = new Map(songRows.map((r) => [r.id, r]));

  for (const track of tracks) {
    const songRow = track.songId ? songLookup.get(track.songId) : null;
    if (
      songRow &&
      songRow.spotifyTrackId &&
      songRow.spotifyTrackId !== SPOTIFY_NEGATIVE_SENTINEL
    ) {
      uris.push(`spotify:track:${songRow.spotifyTrackId}`);
      durationMs += songRow.durationMs ?? 0;
      hits += 1;
      log.debug(
        {
          event: 'spotify.track_resolve.hit',
          source: 'songs_table',
          title: track.title,
        },
        'Track resolved from songs table',
      );
      continue;
    }

    const key = cacheKey(artist, track.title);
    const cached = trackResolveCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.track) {
        uris.push(cached.track.uri);
        durationMs += cached.track.durationMs;
        hits += 1;
      } else {
        missing.push(track.title);
        misses += 1;
      }
      log.debug(
        {
          event: 'spotify.track_resolve.hit',
          source: 'memory_cache',
          title: track.title,
          found: !!cached.track,
        },
        'Track resolution served from cache',
      );
      continue;
    }

    let result: SpotifyTrack | null = null;
    try {
      result = await searchTrack(accessToken, artist, track.title);
    } catch (err) {
      log.error(
        { err, event: 'spotify.track_resolve.failed', title: track.title },
        'Spotify track search failed',
      );
      // Don't poison the cache on failure — let the next caller retry.
      missing.push(track.title);
      continue;
    }
    trackResolveCache.set(key, {
      track: result,
      expiresAt: Date.now() + TRACK_RESOLVE_TTL_MS,
    });
    if (result) {
      uris.push(result.uri);
      durationMs += result.durationMs;
      misses += 1; // counted as miss for cache telemetry — we hit Spotify
      log.debug(
        { event: 'spotify.track_resolve.miss', title: track.title, source: 'spotify_search' },
        'Track resolved via Spotify search',
      );
    } else {
      missing.push(track.title);
      misses += 1;
      log.debug(
        { event: 'spotify.track_resolve.miss', title: track.title, source: 'spotify_search', found: false },
        'Track not found on Spotify',
      );
    }
  }

  return {
    uris,
    durationMs,
    resolved: uris.length,
    requested: tracks.length,
    missing,
    hits,
    misses,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Existing-playlist lookup (idempotency)
// ─────────────────────────────────────────────────────────────────────

export async function getExistingPlaylist(opts: {
  userId: string;
  showId: string;
  kind: PlaylistKind;
}): Promise<{
  playlistId: string;
  spotifyUrl: string;
  trackCount: number;
  durationMs: number;
} | null> {
  const [row] = await db
    .select({
      playlistId: showSpotifyPlaylists.playlistId,
      spotifyUrl: showSpotifyPlaylists.spotifyUrl,
      trackCount: showSpotifyPlaylists.trackCount,
      durationMs: showSpotifyPlaylists.durationMs,
    })
    .from(showSpotifyPlaylists)
    .where(
      and(
        eq(showSpotifyPlaylists.userId, opts.userId),
        eq(showSpotifyPlaylists.showId, opts.showId),
        eq(showSpotifyPlaylists.kind, opts.kind),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// Scope verification
// ─────────────────────────────────────────────────────────────────────

async function getStoredScope(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ scope: userSpotifyTokens.scope })
    .from(userSpotifyTokens)
    .where(eq(userSpotifyTokens.userId, userId))
    .limit(1);
  return row?.scope ?? null;
}

/**
 * Confirm the persisted token grants the scopes the playlist mutations
 * require. Returns the missing scope set when probing fails. Callers
 * surface this as a re-connect prompt and emit
 * `spotify.scopes.missing`.
 */
export async function probePlaylistScopes(
  userId: string,
): Promise<{ missing: string[]; granted: string[] }> {
  const scope = await getStoredScope(userId);
  return diffScopes(scope, HYPE_PLAYLIST_SCOPES);
}

// ─────────────────────────────────────────────────────────────────────
// Show + setlist loading
// ─────────────────────────────────────────────────────────────────────

interface ShowContext {
  show: typeof shows.$inferSelect & {
    showPerformers: Array<
      typeof showPerformers.$inferSelect & {
        performer: typeof performers.$inferSelect;
      }
    >;
    venue: { id: string; name: string };
  };
  headlinerId: string;
  headlinerName: string;
}

async function loadShowContext(
  dbi: Database,
  userId: string,
  showId: string,
): Promise<ShowContext> {
  const show = await dbi.query.shows.findFirst({
    where: and(eq(shows.id, showId), eq(shows.userId, userId)),
    with: {
      showPerformers: { with: { performer: true } },
      venue: true,
    },
  });
  if (!show) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
  }
  if (isProductionShow(show as ShowLike)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Hype playlists are not available for production shows',
    });
  }
  const headlinerId = getHeadlinerId(show as ShowLike);
  if (!headlinerId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Show has no headliner',
    });
  }
  const headliner = show.showPerformers.find(
    (sp) => sp.performer.id === headlinerId,
  );
  if (!headliner) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Headliner performer not found in lineup',
    });
  }
  return {
    show: show as ShowContext['show'],
    headlinerId,
    headlinerName: headliner.performer.name,
  };
}

function predictedTracks(prediction: HotPrediction): SetlistTrack[] {
  // The HotPrediction `core` field is the ordered "likely" setlist
  // with openers first and encore_close last (see
  // setlist-predict.ts:pickRole). We use it directly.
  const core = prediction.core;
  const main = core.filter(
    (s) => s.role !== 'encore_open' && s.role !== 'encore_close',
  );
  const encore = core.filter(
    (s) => s.role === 'encore_open' || s.role === 'encore_close',
  );
  return [...main, ...encore].map((song) => ({
    title: song.title,
    songId: song.songId,
  }));
}

function actualTracksFromSetlist(setlist: PerformerSetlist): SetlistTrack[] {
  const out: SetlistTrack[] = [];
  // Main sections first (in the order they appear), encores last.
  const mainSections = setlist.sections.filter((s) => s.kind !== 'encore');
  const encoreSections = setlist.sections.filter((s) => s.kind === 'encore');
  for (const section of [...mainSections, ...encoreSections]) {
    for (const song of section.songs) {
      out.push({ title: song.title });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Public — create playlists
// ─────────────────────────────────────────────────────────────────────

export interface CreateHypeInput {
  userId: string;
  showId: string;
}

/**
 * Pre-show hype playlist. Loads the predicted setlist, resolves each
 * song to a Spotify URI, creates a private playlist with the
 * Showbook-branded name, and adds tracks in 100-URI batches in the
 * predicted set order.
 *
 * Idempotent: a second call with the same `(showId, userId)` returns
 * the previously created playlist without re-mutating Spotify state.
 */
export async function createHypePlaylist(
  input: CreateHypeInput,
): Promise<CreatePlaylistResult> {
  return withTrace(
    'spotify.createHypePlaylist',
    () => createHypePlaylistInner(input),
    { userId: input.userId, metadata: { showId: input.showId } },
  );
}

async function createHypePlaylistInner(
  input: CreateHypeInput,
): Promise<CreatePlaylistResult> {
  // Idempotency short-circuit.
  const existing = await getExistingPlaylist({
    userId: input.userId,
    showId: input.showId,
    kind: 'hype',
  });
  if (existing) {
    log.info(
      {
        event: 'spotify.hype_playlist.reused',
        userId: input.userId,
        showId: input.showId,
        playlistId: existing.playlistId,
      },
      'Returning existing hype playlist',
    );
    return { ...existing, requested: existing.trackCount, missing: [], reused: true };
  }

  const ctx = await loadShowContext(db, input.userId, input.showId);
  if (ctx.show.kind !== 'concert' && ctx.show.kind !== 'festival') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Hype playlist is only available for concerts and festivals',
    });
  }
  if (!ctx.show.date) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Hype playlist requires a committed performance date',
    });
  }

  const prediction = await predictedSetlistCached({
    performerId: ctx.headlinerId,
    targetDate: ctx.show.date,
  });
  if (prediction.style === 'cold') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `prediction_cold:${prediction.reason}`,
    });
  }
  if (prediction.style !== 'stable') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'prediction_rotating_unavailable',
    });
  }

  const tracks = predictedTracks(prediction);
  if (tracks.length === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'prediction_empty',
    });
  }

  return executePlaylistCreate({
    userId: input.userId,
    showId: input.showId,
    kind: 'hype',
    tracks,
    meta: {
      artistName: ctx.headlinerName,
      venueName: ctx.show.venue.name,
      date: ctx.show.date,
      confidence: prediction.confidence,
    },
  });
}

export interface CreateHeardInput {
  userId: string;
  showId: string;
}

/**
 * Post-show "I Heard" playlist. Same shape as `createHypePlaylist`
 * but sourced from the actual recorded setlist (per-performer
 * `shows.setlists` map; falls back to the legacy `shows.setlist`
 * array).
 */
export async function createHeardPlaylist(
  input: CreateHeardInput,
): Promise<CreatePlaylistResult> {
  return withTrace(
    'spotify.createHeardPlaylist',
    () => createHeardPlaylistInner(input),
    { userId: input.userId, metadata: { showId: input.showId } },
  );
}

async function createHeardPlaylistInner(
  input: CreateHeardInput,
): Promise<CreatePlaylistResult> {
  const existing = await getExistingPlaylist({
    userId: input.userId,
    showId: input.showId,
    kind: 'heard',
  });
  if (existing) {
    log.info(
      {
        event: 'spotify.heard_playlist.reused',
        userId: input.userId,
        showId: input.showId,
        playlistId: existing.playlistId,
      },
      'Returning existing heard playlist',
    );
    return { ...existing, requested: existing.trackCount, missing: [], reused: true };
  }

  const ctx = await loadShowContext(db, input.userId, input.showId);
  if (!ctx.show.date) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Heard playlist requires a performance date',
    });
  }

  const setlistsMap = normalizePerformerSetlistsMap(ctx.show.setlists);
  let headlinerSetlist = setlistsMap[ctx.headlinerId];
  if (!headlinerSetlist && ctx.show.setlist && ctx.show.setlist.length > 0) {
    headlinerSetlist = {
      sections: [
        { kind: 'set', songs: ctx.show.setlist.map((title) => ({ title })) },
      ],
    };
  }
  if (!headlinerSetlist || setlistTotalSongs(headlinerSetlist) === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'setlist_empty',
    });
  }

  const tracks = actualTracksFromSetlist(headlinerSetlist);
  return executePlaylistCreate({
    userId: input.userId,
    showId: input.showId,
    kind: 'heard',
    tracks,
    meta: {
      artistName: ctx.headlinerName,
      venueName: ctx.show.venue.name,
      date: ctx.show.date,
      confidence: null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Shared executor — used by both create paths after the source-of-truth
// setlist has been resolved.
// ─────────────────────────────────────────────────────────────────────

interface ExecuteInput {
  userId: string;
  showId: string;
  kind: PlaylistKind;
  tracks: SetlistTrack[];
  meta: PlaylistMetadata;
}

async function executePlaylistCreate(
  input: ExecuteInput,
): Promise<CreatePlaylistResult> {
  const accessToken = await ensureFreshUserToken(input.userId);
  if (!accessToken) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'spotify_not_connected',
    });
  }

  const scopeCheck = await probePlaylistScopes(input.userId);
  if (scopeCheck.missing.length > 0) {
    log.warn(
      {
        event: 'spotify.scopes.missing',
        userId: input.userId,
        missing: scopeCheck.missing,
      },
      'Spotify connection missing required scopes',
    );
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `spotify_scopes_missing:${scopeCheck.missing.join(',')}`,
    });
  }

  // Resolve titles → URIs.
  let resolution: PlaylistResolution;
  try {
    resolution = await resolveTrackUris(
      accessToken,
      input.meta.artistName,
      input.tracks,
    );
  } catch (err) {
    log.error(
      {
        err,
        event: `spotify.${input.kind}_playlist.failed`,
        stage: 'resolve',
        userId: input.userId,
        showId: input.showId,
      },
      'Track resolution failed',
    );
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'track_resolve_failed',
    });
  }

  if (resolution.uris.length === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'no_tracks_resolved',
    });
  }

  const name = buildPlaylistName(input.kind, input.meta);
  const description = buildPlaylistDescription(input.kind, input.meta);

  let playlist;
  try {
    playlist = await createPlaylist(accessToken, {
      name,
      description,
      isPublic: false,
    });
  } catch (err) {
    log.error(
      {
        err,
        event: `spotify.${input.kind}_playlist.failed`,
        stage: 'create',
        userId: input.userId,
        showId: input.showId,
      },
      'Spotify playlist create failed',
    );
    if (err instanceof SpotifyError) {
      throw new TRPCError({
        code: err.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_SERVER_ERROR',
        message: `spotify_create_failed:${err.status}`,
      });
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'spotify_create_failed',
    });
  }

  // Add tracks in 100-URI batches.
  try {
    for (let offset = 0; offset < resolution.uris.length; offset += 100) {
      const batch = resolution.uris.slice(offset, offset + 100);
      await addTracksToPlaylist(
        accessToken,
        playlist.id,
        batch,
        // First batch has no position so Spotify appends; subsequent
        // batches pin to the end via the running offset.
        offset === 0 ? undefined : offset,
      );
    }
  } catch (err) {
    log.error(
      {
        err,
        event: `spotify.${input.kind}_playlist.failed`,
        stage: 'add_tracks',
        userId: input.userId,
        showId: input.showId,
        playlistId: playlist.id,
      },
      'Spotify add-tracks failed',
    );
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'spotify_add_tracks_failed',
    });
  }

  // Persist the show_spotify_playlists row. ON CONFLICT keeps the
  // first-write authoritative if two requests race; the loser returns
  // the winner's record on the next idempotency check.
  await db
    .insert(showSpotifyPlaylists)
    .values({
      showId: input.showId,
      userId: input.userId,
      kind: input.kind,
      playlistId: playlist.id,
      spotifyUrl: playlist.spotifyUrl,
      trackCount: resolution.uris.length,
      durationMs: resolution.durationMs,
    })
    .onConflictDoNothing();

  log.info(
    {
      event: `spotify.${input.kind}_playlist.created`,
      userId: input.userId,
      showId: input.showId,
      playlistId: playlist.id,
      trackCount: resolution.uris.length,
      requested: resolution.requested,
      missing: resolution.missing.length,
      cacheHits: resolution.hits,
      cacheMisses: resolution.misses,
    },
    'Spotify playlist created',
  );

  return {
    playlistId: playlist.id,
    spotifyUrl: playlist.spotifyUrl,
    trackCount: resolution.uris.length,
    durationMs: resolution.durationMs,
    requested: resolution.requested,
    missing: resolution.missing,
    reused: false,
  };
}

