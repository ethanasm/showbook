import { child } from '@showbook/observability';

const log = child({ component: 'api.spotify', provider: 'spotify' });

const API_BASE = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

/**
 * The complete set of scopes the setlist-intelligence feature needs,
 * batched into a single OAuth dialog so the user only consents once
 * (per `docs/specs/setlist-intelligence/implementation.md` §2).
 *
 *   user-follow-read           — Spotify-follow rail · Spotify artist import
 *   playlist-modify-private    — Hype + post-show + year-end playlists
 *   playlist-modify-public     — Public-variant of the above (kept for
 *                                 future "share my hype" toggle; the
 *                                 default Phase 3 hype playlist is private)
 *   ugc-image-upload           — Branded covers on those playlists
 *   user-library-read          — Fan-loyalty ring · discovered-live rail
 *   user-library-modify        — "Save this song" button
 *   user-read-recently-played  — Pre-show priming stat
 *   user-read-currently-playing — Live-mode setlist capture (deferred)
 *   user-top-read              — Top-tracks blend into predicted setlists
 *
 * Adding a scope here requires every existing token to be re-OAuth'd
 * before the new scope's features work — Spotify scopes are baked into
 * the issued refresh token. Bias toward including future-need scopes
 * here at first connect rather than asking again.
 */
export const SPOTIFY_SCOPES = [
  'user-follow-read',
  'playlist-modify-private',
  'playlist-modify-public',
  'ugc-image-upload',
  'user-library-read',
  'user-library-modify',
  'user-read-recently-played',
  'user-read-currently-playing',
  'user-top-read',
] as const;

export const SPOTIFY_SCOPE_STRING = SPOTIFY_SCOPES.join(' ');

export interface SpotifyArtist {
  id: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
}

interface SpotifyArtistRaw {
  id: string;
  name: string;
  images?: Array<{ url: string; width?: number; height?: number }>;
  genres?: string[];
}

interface SpotifyFollowedArtistsResponse {
  artists: {
    items: SpotifyArtistRaw[];
    next: string | null;
    cursors?: { after?: string };
  };
}

export class SpotifyError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
    this.name = 'SpotifyError';
  }
}

function pickImage(images: SpotifyArtistRaw['images']): string | null {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort(
    (a, b) => Math.abs((a.width ?? 0) - 320) - Math.abs((b.width ?? 0) - 320),
  );
  return sorted[0]?.url ?? null;
}

/**
 * Maximum 429 retries for a single `spotifyFetch` call. With the per-retry
 * sleep capped at 5s, this bounds a single call to ~25s of backoff before it
 * throws a `SpotifyError(status=429)` instead of recursing forever. The cap
 * matters for the batch crons (album-metadata-fill in particular): an
 * unbounded recursion let a single performer iteration run arbitrarily long
 * under a sustained 429 storm, blowing past the job's 1800s pg-boss
 * `expireInSeconds` mid-iteration — the job's between-performer wall-clock
 * budget can't catch that — so the run was killed into pg-boss `failed`
 * state and tripped the `pgboss_queue` morning health check. Callers already
 * handle `SpotifyError`, so a bounded throw degrades gracefully.
 */
const MAX_429_RETRIES = 5;

async function spotifyFetch(
  url: string,
  accessToken: string,
  attempt = 0,
): Promise<Response> {
  const startedAt = Date.now();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const durationMs = Date.now() - startedAt;
  if (response.status === 429) {
    if (attempt >= MAX_429_RETRIES) {
      log.warn(
        { event: 'spotify.request.rate_limited_exhausted', attempt, durationMs },
        'Spotify 429 retry budget exhausted',
      );
      throw new SpotifyError(
        `Spotify rate limit: ${MAX_429_RETRIES} retries exhausted`,
        429,
      );
    }
    const retryAfter = Number(response.headers.get('Retry-After') ?? '2');
    log.warn(
      { event: 'spotify.request.rate_limited', retryAfter, attempt, durationMs },
      'Spotify 429, retrying',
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(retryAfter, 5) * 1000),
    );
    return spotifyFetch(url, accessToken, attempt + 1);
  }
  if (!response.ok) {
    log.warn(
      { event: 'spotify.request.error', status: response.status, durationMs },
      'Spotify non-OK response',
    );
  }
  return response;
}

// ---------------------------------------------------------------------------
// OAuth token exchange + refresh
// ---------------------------------------------------------------------------

export interface SpotifyTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  scope: string;
  tokenType: string;
}

interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string; // omitted on refresh-grant when unchanged
  expires_in: number;
  scope: string;
  token_type: string;
}

function basicAuthHeader(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new SpotifyError(
      'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set',
      0,
    );
  }
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

/**
 * Exchange an authorization-code grant for a token set. Used by the OAuth
 * callback in Phase 0; the callback then persists the tokens encrypted via
 * `spotify-tokens.persistInitialToken`.
 */
export async function exchangeAuthorizationCode(opts: {
  code: string;
  redirectUri: string;
}): Promise<SpotifyTokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      code: opts.code,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new SpotifyError(
      `Spotify token exchange ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
  const data = (await res.json()) as SpotifyTokenResponse;
  if (!data.refresh_token) {
    // Refresh token is only optional on the *refresh* grant. The initial
    // authorization-code exchange must include one — bail loudly if not.
    throw new SpotifyError(
      'Spotify token exchange missing refresh_token',
      0,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

/**
 * Trade a refresh token for a fresh access token. Spotify *may* return a
 * new refresh token in the response — when it doesn't, the caller keeps
 * the existing one (`refreshToken` field reuses the input).
 */
export async function refreshSpotifyToken(
  refreshToken: string,
): Promise<SpotifyTokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new SpotifyError(
      `Spotify token refresh ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
  const data = (await res.json()) as SpotifyTokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresIn: data.expires_in,
    scope: data.scope,
    tokenType: data.token_type,
  };
}

// ---------------------------------------------------------------------------
// App-level (client-credentials) token — Phase 11 §15m album-metadata-fill
// ---------------------------------------------------------------------------

/**
 * Module-level cache for the app-level access token. Spotify hands out
 * ~1-hour tokens for the `client_credentials` grant. The cache `expiresAt`
 * is derived from Spotify's `expires_in` minus a small safety margin
 * (clock skew + the time it takes a long loop to reach its last call).
 * The token is harmless if leaked — it grants only public catalog reads.
 */
let cachedAppToken: { token: string; expiresAt: number } | null = null;

/**
 * Acquire an app-level access token via the `client_credentials` flow.
 * Used by the `album-metadata-fill` job to call public catalog
 * endpoints (`/v1/artists/{id}/albums`, `/v1/search`) without needing
 * any user's refresh token.
 */
export async function getAppAccessToken(): Promise<string> {
  if (cachedAppToken && cachedAppToken.expiresAt > Date.now()) {
    return cachedAppToken.token;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new SpotifyError(
      `Spotify app-token exchange ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
  const data = (await res.json()) as SpotifyTokenResponse;
  // Trust Spotify's `expires_in` minus a 60s safety margin instead of
  // a hard-coded 50-minute TTL. The hard-coded TTL was reused across
  // runs of the album-metadata-fill cron and could outlive the actual
  // Spotify-side expiry by ~10 minutes when a job started near the
  // tail of the cached window, surfacing as a wave of 401s mid-loop.
  const ttlMs = Math.max(60_000, (data.expires_in - 60) * 1000);
  cachedAppToken = {
    token: data.access_token,
    expiresAt: Date.now() + ttlMs,
  };
  return data.access_token;
}

/**
 * Drop the cached app-level token so the next `getAppAccessToken()` call
 * re-fetches. Use after observing a 401 from a Spotify endpoint that took
 * an app-level token — the cache entry may still be within its computed
 * TTL but Spotify already considers the underlying token invalid (early
 * server-side expiry, key rotation, etc.).
 */
export function invalidateAppAccessToken(): void {
  cachedAppToken = null;
}

/**
 * Run `fn` with a fresh app-level token, retrying once on a 401 after
 * dropping the cache. The retry covers two cases that cropped up in the
 * album-metadata-fill cron: (1) a long loop that picked up a cached
 * token near its tail and outlived the Spotify-side expiry, (2) Spotify
 * returning the cached token to early server-side expiry. Other Spotify
 * errors (4xx/5xx/network) bubble unchanged so per-call handling and
 * error logs stay accurate.
 */
export async function withAppToken<T>(
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAppAccessToken();
    try {
      return await fn(token);
    } catch (err) {
      if (attempt === 0 && err instanceof SpotifyError && err.status === 401) {
        invalidateAppAccessToken();
        continue;
      }
      throw err;
    }
  }
  // The for-loop above always returns or throws; this is unreachable
  // but TypeScript can't see that.
  throw new SpotifyError('withAppToken: exhausted retries', 0);
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  /** YYYY or YYYY-MM or YYYY-MM-DD; we round up to the 1st of the
   *  month when only YYYY-MM is provided. */
  releaseDate: string;
  /** 'album' | 'single' | 'compilation' */
  albumType: string;
}

interface SpotifyAlbumRaw {
  id: string;
  name: string;
  release_date: string;
  release_date_precision?: 'day' | 'month' | 'year';
  album_type: string;
}

/**
 * Public catalog: fetch an artist's latest albums (newest first).
 * Excludes compilations + features. Used by `album-metadata-fill`.
 */
export async function getArtistAlbums(
  artistId: string,
  accessToken: string,
  opts: { limit?: number } = {},
): Promise<SpotifyAlbum[]> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 5));
  const url = `${API_BASE}/artists/${encodeURIComponent(artistId)}/albums?include_groups=album,single&limit=${limit}&market=US`;
  const res = await spotifyFetch(url, accessToken);
  if (!res.ok) {
    throw new SpotifyError(`Spotify getArtistAlbums ${res.status}`, res.status);
  }
  const data = (await res.json()) as { items: SpotifyAlbumRaw[] };
  return data.items.map((a) => ({
    id: a.id,
    name: a.name,
    releaseDate: normalizeReleaseDate(a.release_date, a.release_date_precision),
    albumType: a.album_type,
  }));
}

function normalizeReleaseDate(
  raw: string,
  precision: 'day' | 'month' | 'year' | undefined,
): string {
  if (!raw) return raw;
  if (precision === 'year' || /^\d{4}$/.test(raw)) return `${raw}-01-01`;
  if (precision === 'month' || /^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  return raw;
}

export interface SpotifyAlbumTracks {
  trackIds: string[];
}

/**
 * Fetch an album's track list (just the Spotify track ids — names are
 * resolved separately against the `songs` table when synthesizing
 * album-drop rows).
 */
export async function getAlbumTracks(
  albumId: string,
  accessToken: string,
): Promise<SpotifyAlbumTracks> {
  const url = `${API_BASE}/albums/${encodeURIComponent(albumId)}/tracks?limit=50`;
  const res = await spotifyFetch(url, accessToken);
  if (!res.ok) {
    throw new SpotifyError(`Spotify getAlbumTracks ${res.status}`, res.status);
  }
  const data = (await res.json()) as { items: Array<{ id: string }> };
  return { trackIds: data.items.map((t) => t.id).filter(Boolean) };
}

// ---------------------------------------------------------------------------
// /me — current user profile
// ---------------------------------------------------------------------------

export interface SpotifyMe {
  id: string;
  displayName: string | null;
  product: string | null; // 'free' | 'premium' | 'open'
}

interface SpotifyMeRaw {
  id: string;
  display_name?: string | null;
  product?: string | null;
}

/**
 * Fetch the current user's Spotify profile. Used during connect to
 * persist `spotify_user_id` / `display_name` / `product` on the tokens
 * row so we can address the user without a second hop on every read.
 */
export async function getCurrentUser(accessToken: string): Promise<SpotifyMe> {
  const res = await spotifyFetch(`${API_BASE}/me`, accessToken);
  if (!res.ok) {
    const detail = await res.text();
    throw new SpotifyError(
      `Spotify /me ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
  const raw = (await res.json()) as SpotifyMeRaw;
  return {
    id: raw.id,
    displayName: raw.display_name ?? null,
    product: raw.product ?? null,
  };
}

/**
 * Fetch the user's followed artists, paging through Spotify's cursor API.
 * Caps at 1000 to bound import time/cost; users with more should narrow
 * by reorganizing their Spotify library.
 */
export async function getFollowedArtists(
  accessToken: string,
): Promise<SpotifyArtist[]> {
  const all: SpotifyArtist[] = [];
  const HARD_CAP = 1000;
  let url: string | null = `${API_BASE}/me/following?type=artist&limit=50`;

  while (url && all.length < HARD_CAP) {
    const res: Response = await spotifyFetch(url, accessToken);
    if (!res.ok) {
      const detail = await res.text();
      throw new SpotifyError(
        `Spotify ${res.status}`,
        res.status,
        detail.slice(0, 500),
      );
    }
    const data = (await res.json()) as SpotifyFollowedArtistsResponse;
    for (const item of data.artists.items) {
      all.push({
        id: item.id,
        name: item.name,
        imageUrl: pickImage(item.images),
        genres: item.genres ?? [],
      });
    }
    url = data.artists.next;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Track search — for hype / heard playlist resolution
// ---------------------------------------------------------------------------

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  durationMs: number;
  /**
   * 30-second preview clip URL. Often null since Spotify started
   * thinning these in 2024 — callers must treat absence as graceful
   * degradation (hide the play button on the row).
   */
  previewUrl: string | null;
}

interface SpotifyTrackRaw {
  id: string;
  uri: string;
  name: string;
  artists: Array<{ name: string }>;
  duration_ms: number;
  preview_url?: string | null;
}

interface SpotifyTrackSearchResponse {
  tracks?: {
    items: SpotifyTrackRaw[];
  };
}

/**
 * Search Spotify's catalog for a single song. Returns the top track-search
 * hit when one exists, else `null`. Used by the hype/heard playlist
 * orchestrator to turn predicted/actual setlist titles into Spotify URIs.
 *
 * The query intentionally pins both `artist:` and `track:` so we don't
 * accidentally match a cover of the same song by a different performer
 * — the playlist title says "{artist} @ {venue}" so the wrong-artist
 * version would be a visible error.
 */
export async function searchTrack(
  accessToken: string,
  artist: string,
  title: string,
): Promise<SpotifyTrack | null> {
  const q = `artist:${artist} track:${title}`;
  const url = `${API_BASE}/search?type=track&limit=1&q=${encodeURIComponent(q)}`;
  const res = await spotifyFetch(url, accessToken);
  if (!res.ok) {
    const detail = await res.text();
    throw new SpotifyError(
      `Spotify search ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
  const data = (await res.json()) as SpotifyTrackSearchResponse;
  const top = data.tracks?.items?.[0];
  if (!top) return null;
  return {
    id: top.id,
    uri: top.uri,
    name: top.name,
    artists: top.artists.map((a) => a.name),
    durationMs: top.duration_ms,
    previewUrl: top.preview_url ?? null,
  };
}

interface SpotifyArtistSearchResponse {
  artists: {
    items: SpotifyArtistRaw[];
  };
}

/**
 * Resolve a free-text artist name to a Spotify catalog artist via
 * `/v1/search?type=artist`. Returns the top match, or null when Spotify
 * has no result for the name. Used by:
 *
 *  - The fire-and-forget hook on `matchOrCreatePerformer` so every new
 *    performer row gets a `spotify_artist_id` shortly after creation.
 *  - The `backfill-performer-spotify-ids` nightly cron + admin one-shot.
 *
 * Disambiguation: Spotify's relevance ranking already biases toward the
 * most-followed exact-name match, which is correct for ~all of our
 * inputs (popular touring acts). We only override when the top result's
 * name doesn't match the query case-insensitively AND a later result
 * does — that catches cases where a tribute act outranks the original
 * for an exact-name query.
 *
 * Auth: pass either an app-level `client_credentials` token (preferred
 * for backfills) or a per-user OAuth token. Both work — this is public
 * catalog data.
 */
export async function searchSpotifyArtist(
  accessToken: string,
  name: string,
): Promise<SpotifyArtist | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const url = `${API_BASE}/search?type=artist&limit=5&q=${encodeURIComponent(trimmed)}`;
  const res = await spotifyFetch(url, accessToken);
  if (!res.ok) {
    const detail = await res.text();
    throw new SpotifyError(
      `Spotify artist search ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
  const data = (await res.json()) as SpotifyArtistSearchResponse;
  const items = data.artists?.items ?? [];
  if (items.length === 0) return null;

  const target = trimmed.toLowerCase();
  const exact = items.find((a) => a.name.trim().toLowerCase() === target);
  const pick = exact ?? items[0]!;

  return {
    id: pick.id,
    name: pick.name,
    imageUrl: pickImage(pick.images),
    genres: pick.genres ?? [],
  };
}

// ---------------------------------------------------------------------------
// Playlist mutations — create + add tracks
// ---------------------------------------------------------------------------

export interface SpotifyPlaylist {
  id: string;
  spotifyUrl: string;
  name: string;
}

interface SpotifyPlaylistRaw {
  id: string;
  name: string;
  external_urls?: { spotify?: string };
}

/**
 * Create an empty private playlist on the current user's account. Returns
 * the new playlist's id + public `external_urls.spotify` URL. Spotify's
 * `description` field is plaintext and capped at 300 chars.
 */
export async function createPlaylist(
  accessToken: string,
  opts: { name: string; description: string; isPublic?: boolean },
): Promise<SpotifyPlaylist> {
  const url = `${API_BASE}/me/playlists`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: opts.name,
      description: opts.description.slice(0, 300),
      public: opts.isPublic === true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new SpotifyError(
      `Spotify create-playlist ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
  const data = (await res.json()) as SpotifyPlaylistRaw;
  return {
    id: data.id,
    name: data.name,
    spotifyUrl: data.external_urls?.spotify ?? `https://open.spotify.com/playlist/${data.id}`,
  };
}

/**
 * Add a batch of track URIs to a playlist. Spotify caps each request at
 * 100 URIs; callers above this helper batch larger sets and call this
 * repeatedly with the appropriate `position`.
 */
export async function addTracksToPlaylist(
  accessToken: string,
  playlistId: string,
  uris: string[],
  position?: number,
): Promise<void> {
  if (uris.length === 0) return;
  if (uris.length > 100) {
    throw new SpotifyError(
      `addTracksToPlaylist accepts ≤100 URIs per call (got ${uris.length})`,
      0,
    );
  }
  const url = `${API_BASE}/playlists/${encodeURIComponent(playlistId)}/items`;
  const body: Record<string, unknown> = { uris };
  if (typeof position === 'number') body.position = position;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new SpotifyError(
      `Spotify add-tracks ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
}

// ---------------------------------------------------------------------------
// Library cross-reference (GET /me/library/contains)
// ---------------------------------------------------------------------------

/**
 * Spotify's generic `/me/library` endpoints cap each request at 40
 * URIs — tighter than the per-type endpoints' 50-id ceiling. Setlists
 * rarely exceed this, but the batch loop is straightforward so larger
 * inputs still work.
 */
const LIBRARY_BATCH = 40;

function trackIdsToUris(trackIds: string[]): string[] {
  return trackIds.map((id) => `spotify:track:${id}`);
}

/**
 * Check whether each of `trackIds` is in the connected user's saved
 * library. Wraps `GET /v1/me/library/contains?uris=spotify:track:...` —
 * the generic library endpoint accepts full Spotify URIs and caps at
 * 40 per call. Returns a boolean array in the same order as the input
 * track ids; larger inputs batch across multiple calls and are
 * stitched back together.
 *
 * Used by the Phase 7 fan-loyalty + discovered-live procedures (per-show
 * intersection, on demand). Empty input short-circuits — no HTTP call.
 */
export async function tracksContains(
  accessToken: string,
  trackIds: string[],
): Promise<boolean[]> {
  if (trackIds.length === 0) return [];
  const out: boolean[] = [];
  for (let offset = 0; offset < trackIds.length; offset += LIBRARY_BATCH) {
    const batch = trackIds.slice(offset, offset + LIBRARY_BATCH);
    const uris = trackIdsToUris(batch).join(',');
    const url = `${API_BASE}/me/library/contains?uris=${encodeURIComponent(uris)}`;
    const res = await spotifyFetch(url, accessToken);
    if (!res.ok) {
      const detail = await res.text();
      throw new SpotifyError(
        `Spotify /me/library/contains ${res.status}`,
        res.status,
        detail.slice(0, 500),
      );
    }
    const data = (await res.json()) as boolean[];
    if (!Array.isArray(data) || data.length !== batch.length) {
      throw new SpotifyError(
        `Spotify /me/library/contains shape mismatch (expected ${batch.length}, got ${
          Array.isArray(data) ? data.length : typeof data
        })`,
        0,
      );
    }
    out.push(...data);
  }
  return out;
}

/**
 * Save one or more tracks to the user's library — `PUT /v1/me/library`.
 * Requires the `user-library-modify` scope, which is in `SPOTIFY_SCOPES`
 * (granted at first connect). 40-URIs-per-call ceiling on the generic
 * library endpoint. The Phase 7 "save discovered" button only ever
 * passes a single id, but the loop is forwards-compatible with bulk
 * saves.
 */
export async function saveTracksToLibrary(
  accessToken: string,
  trackIds: string[],
): Promise<void> {
  if (trackIds.length === 0) return;
  const url = `${API_BASE}/me/library`;
  for (let offset = 0; offset < trackIds.length; offset += LIBRARY_BATCH) {
    const batch = trackIds.slice(offset, offset + LIBRARY_BATCH);
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: trackIdsToUris(batch) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new SpotifyError(
        `Spotify PUT /me/library ${res.status}`,
        res.status,
        detail.slice(0, 500),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Recently played + top tracks (Phase 7 jobs)
// ---------------------------------------------------------------------------

export interface SpotifyRecentlyPlayedTrack {
  trackId: string;
  trackName: string;
  artistNames: string[];
  playedAt: Date;
}

interface RecentlyPlayedRaw {
  items: Array<{
    track: { id: string; name: string; artists: Array<{ name: string }> };
    played_at: string;
  }>;
}

/**
 * Pull the user's last 50 plays from `/me/player/recently-played`. The
 * Phase 7 priming job buckets the results against the user's shows.
 * `limit` is capped at 50 by Spotify; we forward the default.
 */
export async function getRecentlyPlayed(
  accessToken: string,
  limit = 50,
): Promise<SpotifyRecentlyPlayedTrack[]> {
  const url = `${API_BASE}/me/player/recently-played?limit=${Math.min(
    Math.max(limit, 1),
    50,
  )}`;
  const res = await spotifyFetch(url, accessToken);
  if (!res.ok) {
    const detail = await res.text();
    throw new SpotifyError(
      `Spotify recently-played ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
  const data = (await res.json()) as RecentlyPlayedRaw;
  return (data.items ?? [])
    .filter((item) => item?.track?.id && item?.played_at)
    .map((item) => ({
      trackId: item.track.id,
      trackName: item.track.name,
      artistNames: item.track.artists.map((a) => a.name),
      playedAt: new Date(item.played_at),
    }));
}

export interface SpotifyTopTrack {
  id: string;
  name: string;
  popularity: number;
  artists: string[];
}

interface TopTracksRaw {
  items: Array<{
    id: string;
    name: string;
    popularity: number;
    artists: Array<{ name: string }>;
  }>;
}

/**
 * Per-user `/me/top/tracks?time_range=long_term&limit=50`. Used by the
 * Phase 7 year-end soundtrack scorer (signature-track multiplier) and
 * the predicted-setlist ⭐ top-track chip on PersonalWeightChip overlays.
 */
export async function getTopTracks(
  accessToken: string,
  opts: { timeRange?: 'short_term' | 'medium_term' | 'long_term'; limit?: number } = {},
): Promise<SpotifyTopTrack[]> {
  const timeRange = opts.timeRange ?? 'long_term';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 50);
  const url = `${API_BASE}/me/top/tracks?time_range=${timeRange}&limit=${limit}`;
  const res = await spotifyFetch(url, accessToken);
  if (!res.ok) {
    const detail = await res.text();
    throw new SpotifyError(
      `Spotify top-tracks ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
  const data = (await res.json()) as TopTracksRaw;
  return (data.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    popularity: item.popularity ?? 0,
    artists: item.artists.map((a) => a.name),
  }));
}

// ---------------------------------------------------------------------------
// Playlist cover upload + replace items (year-end soundtrack)
// ---------------------------------------------------------------------------

/**
 * Replace the items on a playlist — `PUT /v1/playlists/{id}/items`.
 * Used by the year-end-soundtrack cron's idempotent re-run: when the
 * users.spotify_year_playlists map already references a playlist for
 * the current year, we overwrite its items rather than creating a
 * duplicate playlist.
 */
export async function replacePlaylistItems(
  accessToken: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  const url = `${API_BASE}/playlists/${encodeURIComponent(playlistId)}/items`;
  if (uris.length > 100) {
    throw new SpotifyError(
      `replacePlaylistItems accepts ≤100 URIs per call (got ${uris.length})`,
      0,
    );
  }
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new SpotifyError(
      `Spotify replace-playlist-items ${res.status}`,
      res.status,
      detail.slice(0, 500),
    );
  }
}

// ---------------------------------------------------------------------------
// Scope inspection
// ---------------------------------------------------------------------------

/**
 * Required Spotify scopes for hype/heard playlist creation. Both are
 * batched in the initial OAuth dialog (see SPOTIFY_SCOPES); this helper
 * lets the playlist mutation surface a "re-connect Spotify" prompt if the
 * persisted row predates the scope addition (or the user revoked one of
 * them in their Spotify account settings).
 */
export const HYPE_PLAYLIST_SCOPES = [
  'playlist-modify-private',
  'playlist-modify-public',
] as const;

export interface MissingScopesResult {
  granted: string[];
  missing: string[];
}

/**
 * Inspect a stored Spotify scope string and return the subset of
 * `required` that's missing. Empty `missing` means the user is fully
 * authorized for the playlist mutations.
 */
export function diffScopes(
  scopeString: string | null | undefined,
  required: readonly string[],
): MissingScopesResult {
  const granted = (scopeString ?? '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const grantedSet = new Set(granted);
  const missing = required.filter((s) => !grantedSet.has(s));
  return { granted, missing };
}
