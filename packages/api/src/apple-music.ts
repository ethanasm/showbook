import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { child } from '@showbook/observability';

const log = child({ component: 'api.apple-music', provider: 'apple-music' });

const API_BASE = 'https://api.music.apple.com';

// Apple caps developer-token lifetime at 6 months (15,777,000 seconds).
// We re-sign every 30 minutes so a leaked token has a small blast radius
// and a key rotation propagates within an hour without any restarts.
const DEV_TOKEN_TTL_SECONDS = 30 * 60;

export interface AppleMusicArtist {
  id: string;
  name: string;
  imageUrl: string | null;
  // Library artists have no genre metadata; included for shape parity with
  // SpotifyArtist so call-sites can remain symmetric.
  genres: string[];
}

interface AppleLibraryArtistRaw {
  id: string;
  type: string;
  attributes?: { name?: string };
}

interface AppleLibraryArtistsResponse {
  data: AppleLibraryArtistRaw[];
  next?: string;
}

export class AppleMusicError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
    this.name = 'AppleMusicError';
  }
}

export class AppleMusicConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppleMusicConfigError';
  }
}

function base64url(input: Buffer | string): string {
  return (input instanceof Buffer ? input : Buffer.from(input))
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

interface DevTokenConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
}

function readDevTokenConfig(): DevTokenConfig {
  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  // Newlines in env files are typically encoded as literal "\n"; restore
  // them so createPrivateKey accepts the PKCS#8 PEM Apple ships.
  const privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!teamId || !keyId || !privateKey) {
    throw new AppleMusicConfigError(
      'Apple Music developer token requires APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, and APPLE_MUSIC_PRIVATE_KEY',
    );
  }
  return { teamId, keyId, privateKey };
}

/**
 * Sign an Apple Music developer token (ES256 JWT). Pure function — takes
 * its inputs explicitly so callers (and tests) don't depend on env state.
 *
 * Output format: JOSE-compact JWT with raw `r||s` 64-byte signature.
 * Apple rejects DER-encoded ECDSA signatures.
 */
export function signDeveloperToken(
  config: DevTokenConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  ttlSeconds: number = DEV_TOKEN_TTL_SECONDS,
): string {
  const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' };
  const payload = {
    iss: config.teamId,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const keyObject = createPrivateKey({ key: config.privateKey, format: 'pem' });
  // dsaEncoding 'ieee-p1363' returns the 64-byte raw r||s signature that
  // JOSE / Apple require; the default 'der' would be rejected.
  const signature = cryptoSign('sha256', Buffer.from(signingInput), {
    key: keyObject,
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${base64url(signature)}`;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}
let tokenCache: CachedToken | null = null;

/**
 * Returns a developer token, signing a fresh one when the cache is empty
 * or within 60s of expiry. Throws AppleMusicConfigError when the
 * required env vars are absent.
 */
export function getDeveloperToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt - now > 60) {
    return tokenCache.token;
  }
  const config = readDevTokenConfig();
  const token = signDeveloperToken(config, now, DEV_TOKEN_TTL_SECONDS);
  tokenCache = { token, expiresAt: now + DEV_TOKEN_TTL_SECONDS };
  return token;
}

/** Test hook — clears the in-memory developer-token cache. */
export function _resetDeveloperTokenCacheForTests(): void {
  tokenCache = null;
}

async function appleMusicFetch(
  url: string,
  developerToken: string,
  musicUserToken: string,
): Promise<Response> {
  const startedAt = Date.now();
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${developerToken}`,
      'Music-User-Token': musicUserToken,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const durationMs = Date.now() - startedAt;
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? '2');
    log.warn(
      { event: 'apple_music.request.rate_limited', retryAfter, durationMs },
      'Apple Music 429, retrying',
    );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(retryAfter, 5) * 1000),
    );
    return appleMusicFetch(url, developerToken, musicUserToken);
  }
  if (!response.ok) {
    log.warn(
      {
        event: 'apple_music.request.error',
        status: response.status,
        durationMs,
      },
      'Apple Music non-OK response',
    );
  }
  return response;
}

/**
 * Fetch the user's library artists, paging through Apple Music's
 * offset-based API. Caps at 1000 to bound import time/cost; users with
 * larger libraries should narrow on the Apple Music side.
 *
 * Library artists carry no images or genres — we return name + id only
 * and let the Ticketmaster match drive the displayed artwork.
 */
export async function getLibraryArtists(
  developerToken: string,
  musicUserToken: string,
): Promise<AppleMusicArtist[]> {
  const all: AppleMusicArtist[] = [];
  const HARD_CAP = 1000;
  let path: string | null = '/v1/me/library/artists?limit=100';

  while (path && all.length < HARD_CAP) {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const res: Response = await appleMusicFetch(
      url,
      developerToken,
      musicUserToken,
    );
    if (!res.ok) {
      const detail = await res.text();
      throw new AppleMusicError(
        `Apple Music ${res.status}`,
        res.status,
        detail.slice(0, 500),
      );
    }
    const data = (await res.json()) as AppleLibraryArtistsResponse;
    for (const item of data.data ?? []) {
      const name = item.attributes?.name;
      if (!name) continue;
      all.push({ id: item.id, name, imageUrl: null, genres: [] });
    }
    path = data.next ?? null;
  }

  return all;
}
