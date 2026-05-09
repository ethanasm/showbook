import { child } from '@showbook/observability';

const log = child({ component: 'api.spotify', provider: 'spotify' });

const API_BASE = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

/**
 * The complete set of scopes the setlist-intelligence feature needs,
 * batched into a single OAuth dialog so the user only consents once
 * (per `showbook-specs/setlist-intelligence/implementation.md` §2).
 *
 *   user-follow-read           — Spotify-follow rail · Spotify artist import
 *   playlist-modify-private    — Hype + post-show + year-end playlists
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

async function spotifyFetch(
  url: string,
  accessToken: string,
): Promise<Response> {
  const startedAt = Date.now();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const durationMs = Date.now() - startedAt;
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? '2');
    log.warn(
      { event: 'spotify.request.rate_limited', retryAfter, durationMs },
      'Spotify 429, retrying',
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(retryAfter, 5) * 1000),
    );
    return spotifyFetch(url, accessToken);
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
