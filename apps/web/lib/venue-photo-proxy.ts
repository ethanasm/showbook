// Hostname allowlists and upstream fetcher for `/api/venue-photo/[venueId]`.
// Lives in `lib/` so the redirect-handling logic can be exercised by a
// unit test with an injected `fetch` (mock.module is unavailable in the
// project's node:test + tsx setup).

// Initial-URL allowlist for absolute `venues.photoUrl` values. The only
// legitimate http(s)-prefixed value persisted to this column is
// Ticketmaster's CDN (returned by `getVenue(...).images[].url`); Google
// Places resolves through `getPlacePhotoMediaUrl` and never lands here
// as a raw URL. Adding a host here without a security review re-opens
// the SSRF vector previously closed by tightening `venueInputSchema`.
export const ALLOWED_PROXY_HOSTS: ReadonlySet<string> = new Set([
  's1.ticketm.net',
]);

// Redirect-target allowlist for the one hop `fetchUpstream` will follow.
// The Google Places Photo (New) endpoint at
// `places.googleapis.com/v1/{name}/media` responds with HTTP 302 to its
// CDN by design — the proxy has to land on one of these to actually
// serve image bytes. Adding a host here without a security review
// expands the SSRF surface (a compromised upstream could redirect to
// anything in this set).
export const ALLOWED_REDIRECT_HOSTS: ReadonlySet<string> = new Set([
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
  // TM CDN may redirect within its own domain.
  's1.ticketm.net',
]);

// Allowlist of content-types we'll proxy back to the client. SVG is
// deliberately excluded — `image/svg+xml` would let a planted upstream
// execute scripts when navigated to directly (the proxy URL is same-
// origin as the rest of the app), and we don't legitimately serve SVG
// for venue hero photos.
export const ALLOWED_CONTENT_TYPE =
  /^image\/(?:png|jpeg|jpg|webp|gif|heic|heif|avif)(?:;.*)?$/i;

export function isProxyableUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return ALLOWED_PROXY_HOSTS.has(parsed.hostname.toLowerCase());
}

export type FetchUpstreamResult = {
  upstream: Response;
  contentType: string;
  ok: boolean;
  // When the failure is specifically a refused redirect target, the
  // caller logs `venue.photo.proxy.redirect_not_allowed` with this
  // hostname (empty string if the Location header was missing or
  // unparseable). Absent on success and on regular upstream failures
  // (4xx/5xx, content-type mismatch, etc.).
  refusedRedirectHost?: string;
};

const TIMEOUT_MS = 15_000;

export async function fetchUpstream(
  mediaUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<FetchUpstreamResult> {
  let upstream = await fetchImpl(mediaUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'manual',
  });

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get('location');
    if (!location) {
      return { upstream, contentType: '', ok: false, refusedRedirectHost: '' };
    }
    let redirectHost: string;
    try {
      redirectHost = new URL(location).hostname.toLowerCase();
    } catch {
      return { upstream, contentType: '', ok: false, refusedRedirectHost: '' };
    }
    if (!ALLOWED_REDIRECT_HOSTS.has(redirectHost)) {
      return {
        upstream,
        contentType: '',
        ok: false,
        refusedRedirectHost: redirectHost,
      };
    }
    upstream = await fetchImpl(location, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // A second redirect lands us back here as a 3xx with no further
      // hop — keeps the SSRF guarantee that the proxy can never follow
      // more than one redirect.
      redirect: 'manual',
    });
  }

  const contentType = upstream.headers.get('content-type') ?? '';
  const ok =
    upstream.ok &&
    upstream.body !== null &&
    ALLOWED_CONTENT_TYPE.test(contentType);
  return { upstream, contentType, ok };
}
