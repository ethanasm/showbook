import { child } from '@showbook/observability';

const log = child({ component: 'api.itunes', provider: 'itunes' });

const SEARCH_URL = 'https://itunes.apple.com/search';

export class ITunesError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
    this.name = 'ITunesError';
  }
}

interface ITunesSearchResultRaw {
  resultCount: number;
  results: Array<{
    artistName?: string;
    trackName?: string;
    previewUrl?: string;
    trackTimeMillis?: number;
    kind?: string;
  }>;
}

export interface ITunesTrackPreview {
  artist: string;
  title: string;
  previewUrl: string;
  durationMs: number | null;
}

/**
 * Search Apple's iTunes Search API for a track preview. The Showbook
 * fallback when Spotify's Search API returns a track without
 * `preview_url` — Spotify thinned previews from new-app API responses
 * starting Nov 2024; iTunes still serves 30s preview clips for the
 * overwhelming majority of mainstream catalogue with CORS headers that
 * load through the page's <audio crossOrigin="anonymous"> element.
 *
 * Returns `null` when the search has no song-kind result, or when
 * iTunes returns a non-OK / non-JSON response. Rate-limit (HTTP 403)
 * is surfaced as `ITunesError(status=403)` so the caller can decide
 * whether to cache the miss or treat it as transient.
 *
 * Apple's documented limit is ~20 req/min per IP; well above what a
 * single user clicking inline ▶ buttons can produce. The caller
 * applies its own per-user rate-limit guard before reaching here.
 */
export async function searchTrackPreview(
  artist: string,
  title: string,
): Promise<ITunesTrackPreview | null> {
  const term = `${artist} ${title}`.trim();
  if (!term) return null;
  const url = `${SEARCH_URL}?term=${encodeURIComponent(term)}&entity=song&limit=1&media=music`;
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    log.warn(
      { err, event: 'itunes.request.network_error', term },
      'iTunes search network error',
    );
    return null;
  }
  const durationMs = Date.now() - startedAt;
  if (response.status === 403) {
    log.warn(
      { event: 'itunes.preview.rate_limited', durationMs, term },
      'iTunes search rate-limited (403)',
    );
    throw new ITunesError('iTunes rate limited', 403);
  }
  if (!response.ok) {
    log.warn(
      { event: 'itunes.request.error', status: response.status, durationMs },
      'iTunes non-OK response',
    );
    return null;
  }
  let data: ITunesSearchResultRaw;
  try {
    data = (await response.json()) as ITunesSearchResultRaw;
  } catch (err) {
    log.warn(
      { err, event: 'itunes.request.parse_error', durationMs },
      'iTunes returned non-JSON body',
    );
    return null;
  }
  const top = data.results?.[0];
  if (!top || top.kind !== 'song' || !top.previewUrl) {
    return null;
  }
  return {
    artist: top.artistName ?? artist,
    title: top.trackName ?? title,
    previewUrl: top.previewUrl,
    durationMs: typeof top.trackTimeMillis === 'number' ? top.trackTimeMillis : null,
  };
}
