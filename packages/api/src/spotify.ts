import { child } from '@showbook/observability';

const log = child({ component: 'api.spotify', provider: 'spotify' });

const API_BASE = 'https://api.spotify.com/v1';

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
