/**
 * Unit tests for apps/web/lib/image-proxy.ts
 *
 * Locks in three behaviours:
 *
 *  1. The Google Places Photo (New) endpoint at
 *     `places.googleapis.com/v1/{name}/media` responds with HTTP 302 to a
 *     `lh3.googleusercontent.com` CDN URL by design. `fetchUpstream` must
 *     follow that one hop or every Places-backed venue photo 502s and
 *     `RemoteImage` falls back to a monogram (the bug that regressed
 *     venue images on 2026-05-17, fourth occurrence).
 *
 *  2. The SSRF defense-in-depth posture from commit aa1203c: a redirect
 *     target outside `ALLOWED_REDIRECT_HOSTS` must be refused with
 *     `refusedRedirectHost` set, so the routes log
 *     `<surface>.proxy.redirect_not_allowed` and return 502.
 *
 *  3. The initial-URL guard `isProxyableUrl` must reject internal,
 *     non-http(s), and unknown hosts so the show-cover and
 *     performer-photo routes (added 2026-05-20) can't be steered at
 *     internal services by a planted `shows.coverImageUrl` /
 *     `performers.imageUrl` value.
 *
 * `fetch` is dependency-injected (mock.module isn't available in this
 * project's node:test + tsx environment).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchUpstream,
  isProxyableUrl,
  ALLOWED_PROXY_HOSTS,
  ALLOWED_REDIRECT_HOSTS,
} from '../image-proxy';

function imageResponse(): Response {
  // 1x1 JPEG-ish bytes — content isn't decoded by the proxy, only
  // streamed through. The content-type is what matters for `ok`.
  return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

// `fetch`'s argument type tolerates both string URLs and URL objects;
// the proxy only ever passes strings, so the test mock can too.
function makeMockFetch(
  responses: Array<{ urlMatches: (url: string) => boolean; response: Response }>,
) {
  const calls: string[] = [];
  const fn = async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    for (const r of responses) {
      if (r.urlMatches(url)) return r.response;
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
  return Object.assign(fn as unknown as typeof fetch, { calls });
}

describe('image-proxy: allowlists', () => {
  it('ALLOWED_PROXY_HOSTS contains s1.ticketm.net (TM CDN)', () => {
    assert.ok(ALLOWED_PROXY_HOSTS.has('s1.ticketm.net'));
  });

  it('ALLOWED_PROXY_HOSTS contains Spotify CDN hosts (performers.imageUrl from SpotifyFollowRail)', () => {
    // The Phase-9 Spotify-follow-rail forwards `match.imageUrl` (the
    // Spotify-side artist photo) into `spotifyImport.importSelected`,
    // so `i.scdn.co` URLs end up persisted to `performers.imageUrl`
    // and must be proxyable. Mirrors `next.config.ts` remotePatterns.
    assert.ok(ALLOWED_PROXY_HOSTS.has('i.scdn.co'));
    assert.ok(ALLOWED_PROXY_HOSTS.has('mosaic.scdn.co'));
  });

  it('ALLOWED_PROXY_HOSTS contains Wikimedia Commons (theatre cast headshots)', () => {
    // Wikidata-resolved cast photos persist as
    // commons.wikimedia.org/wiki/Special:FilePath/... URLs.
    assert.ok(ALLOWED_PROXY_HOSTS.has('commons.wikimedia.org'));
  });

  it('ALLOWED_REDIRECT_HOSTS contains upload.wikimedia.org (Commons CDN hop)', () => {
    // Special:FilePath 302-redirects to the upload.wikimedia.org CDN.
    assert.ok(ALLOWED_REDIRECT_HOSTS.has('upload.wikimedia.org'));
  });

  it('isProxyableUrl accepts a Commons Special:FilePath URL and rejects other wikimedia hosts', () => {
    assert.equal(
      isProxyableUrl(
        'https://commons.wikimedia.org/wiki/Special:FilePath/Cole.png?width=600',
      ),
      true,
    );
    // upload.wikimedia.org is only a redirect target, not an initial host.
    assert.equal(isProxyableUrl('https://upload.wikimedia.org/x.png'), false);
  });

  it('ALLOWED_REDIRECT_HOSTS contains the Google Places photo CDN hosts', () => {
    for (const host of [
      'lh3.googleusercontent.com',
      'lh4.googleusercontent.com',
      'lh5.googleusercontent.com',
      'lh6.googleusercontent.com',
    ]) {
      assert.ok(
        ALLOWED_REDIRECT_HOSTS.has(host),
        `${host} should be allowed as a redirect target`,
      );
    }
  });

  it('isProxyableUrl accepts TM CDN', () => {
    assert.equal(isProxyableUrl('https://s1.ticketm.net/foo/bar.jpg'), true);
  });

  it('isProxyableUrl accepts Spotify CDN hosts', () => {
    assert.equal(
      isProxyableUrl('https://i.scdn.co/image/ab6761610000e5eb0aa1f0e0e0e0e0e0e0e0e0e0'),
      true,
    );
    assert.equal(
      isProxyableUrl('https://mosaic.scdn.co/640/ab123'),
      true,
    );
  });

  it('isProxyableUrl rejects internal / unknown hosts', () => {
    assert.equal(isProxyableUrl('https://internal-host.local/x'), false);
    assert.equal(isProxyableUrl('https://example.com/x'), false);
  });

  it('isProxyableUrl rejects classic SSRF targets (cloud metadata, loopback, RFC1918)', () => {
    // AWS / GCP / Azure instance metadata endpoint.
    assert.equal(isProxyableUrl('http://169.254.169.254/latest/meta-data/'), false);
    // Loopback in every common form.
    assert.equal(isProxyableUrl('http://127.0.0.1:3002/api/admin/sql'), false);
    assert.equal(isProxyableUrl('http://localhost:5433/'), false);
    assert.equal(isProxyableUrl('http://[::1]/'), false);
    // RFC1918 private networks (Docker bridge, k8s pod nets, home LANs).
    assert.equal(isProxyableUrl('http://10.0.0.1/'), false);
    assert.equal(isProxyableUrl('http://192.168.0.1/'), false);
    assert.equal(isProxyableUrl('http://172.16.0.1/'), false);
  });

  it('isProxyableUrl rejects non-http(s) schemes', () => {
    assert.equal(isProxyableUrl('file:///etc/passwd'), false);
    assert.equal(isProxyableUrl('ftp://s1.ticketm.net/x'), false);
  });

  it('isProxyableUrl rejects malformed URLs', () => {
    assert.equal(isProxyableUrl('not a url'), false);
    assert.equal(isProxyableUrl(''), false);
  });
});

describe('image-proxy: fetchUpstream — happy path', () => {
  it('returns 200 image bytes when upstream serves them directly', async () => {
    const mockFetch = makeMockFetch([
      {
        urlMatches: (u) => u.startsWith('https://s1.ticketm.net/'),
        response: imageResponse(),
      },
    ]);

    const result = await fetchUpstream(
      'https://s1.ticketm.net/foo.jpg',
      mockFetch,
    );

    assert.equal(result.ok, true);
    assert.equal(result.contentType, 'image/jpeg');
    assert.equal(result.refusedRedirectHost, undefined);
    assert.equal(mockFetch.calls.length, 1);
  });

  it('follows a 302 from places.googleapis.com to lh3.googleusercontent.com', async () => {
    const cdnUrl = 'https://lh3.googleusercontent.com/places/photo-abc';
    const mockFetch = makeMockFetch([
      {
        urlMatches: (u) => u.startsWith('https://places.googleapis.com/'),
        response: redirectResponse(cdnUrl),
      },
      {
        urlMatches: (u) => u === cdnUrl,
        response: imageResponse(),
      },
    ]);

    const result = await fetchUpstream(
      'https://places.googleapis.com/v1/places/X/photos/Y/media?key=k',
      mockFetch,
    );

    assert.equal(result.ok, true);
    assert.equal(result.contentType, 'image/jpeg');
    assert.equal(result.refusedRedirectHost, undefined);
    assert.equal(mockFetch.calls.length, 2);
    // First call lands on places.googleapis.com, second on the CDN.
    assert.ok(mockFetch.calls[0].startsWith('https://places.googleapis.com/'));
    assert.equal(mockFetch.calls[1], cdnUrl);
  });

  it('handles 301 (permanent) redirects the same as 302', async () => {
    const cdnUrl = 'https://lh4.googleusercontent.com/places/permanent';
    const mockFetch = makeMockFetch([
      {
        urlMatches: (u) => u.startsWith('https://places.googleapis.com/'),
        response: redirectResponse(cdnUrl, 301),
      },
      { urlMatches: (u) => u === cdnUrl, response: imageResponse() },
    ]);

    const result = await fetchUpstream(
      'https://places.googleapis.com/v1/places/X/photos/Y/media',
      mockFetch,
    );

    assert.equal(result.ok, true);
  });
});

describe('image-proxy: fetchUpstream — SSRF guard', () => {
  it('refuses a redirect to a host outside ALLOWED_REDIRECT_HOSTS', async () => {
    const mockFetch = makeMockFetch([
      {
        urlMatches: (u) => u.startsWith('https://places.googleapis.com/'),
        response: redirectResponse('https://evil.example.com/payload'),
      },
    ]);

    const result = await fetchUpstream(
      'https://places.googleapis.com/v1/places/X/photos/Y/media',
      mockFetch,
    );

    assert.equal(result.ok, false);
    assert.equal(result.refusedRedirectHost, 'evil.example.com');
    // Second fetch must NOT have happened — the SSRF guard short-circuits.
    assert.equal(mockFetch.calls.length, 1);
  });

  it('refuses a redirect with an unparseable Location header', async () => {
    const mockFetch = makeMockFetch([
      {
        urlMatches: (u) => u.startsWith('https://places.googleapis.com/'),
        response: redirectResponse('not a url at all'),
      },
    ]);

    const result = await fetchUpstream(
      'https://places.googleapis.com/v1/places/X/photos/Y/media',
      mockFetch,
    );

    assert.equal(result.ok, false);
    assert.equal(result.refusedRedirectHost, '');
    assert.equal(mockFetch.calls.length, 1);
  });

  it('refuses a redirect with no Location header', async () => {
    const mockFetch = makeMockFetch([
      {
        urlMatches: (u) => u.startsWith('https://places.googleapis.com/'),
        response: new Response(null, { status: 302 }),
      },
    ]);

    const result = await fetchUpstream(
      'https://places.googleapis.com/v1/places/X/photos/Y/media',
      mockFetch,
    );

    assert.equal(result.ok, false);
    assert.equal(result.refusedRedirectHost, '');
  });

  it('does NOT follow a second redirect (chained-redirect rejection)', async () => {
    // First call: 302 → allowed CDN. Second call: another 302 (to anywhere).
    // The second fetch uses `redirect: 'manual'`, so it returns the 3xx
    // and `fetchUpstream` reports `ok: false` because `upstream.ok` is
    // false on a 3xx and the content-type isn't a bitmap image.
    const cdnUrl = 'https://lh3.googleusercontent.com/places/abc';
    const mockFetch = makeMockFetch([
      {
        urlMatches: (u) => u.startsWith('https://places.googleapis.com/'),
        response: redirectResponse(cdnUrl),
      },
      {
        urlMatches: (u) => u === cdnUrl,
        response: redirectResponse('https://evil.example.com/x'),
      },
    ]);

    const result = await fetchUpstream(
      'https://places.googleapis.com/v1/places/X/photos/Y/media',
      mockFetch,
    );

    assert.equal(result.ok, false);
    // refusedRedirectHost is only set on the *first*-hop refusal — a
    // second redirect just falls through the regular "not ok" path.
    assert.equal(result.refusedRedirectHost, undefined);
    assert.equal(mockFetch.calls.length, 2);
  });
});

describe('image-proxy: fetchUpstream — content-type guard', () => {
  it('rejects SVG content-type even on a 200 response (XSS guard)', async () => {
    const mockFetch = makeMockFetch([
      {
        urlMatches: () => true,
        response: new Response('<svg onload="alert(1)"/>', {
          status: 200,
          headers: { 'content-type': 'image/svg+xml' },
        }),
      },
    ]);

    const result = await fetchUpstream(
      'https://s1.ticketm.net/x.svg',
      mockFetch,
    );

    assert.equal(result.ok, false);
    assert.equal(result.refusedRedirectHost, undefined);
  });

  it('rejects non-image content-types', async () => {
    const mockFetch = makeMockFetch([
      {
        urlMatches: () => true,
        response: new Response('hello', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      },
    ]);

    const result = await fetchUpstream(
      'https://s1.ticketm.net/x.html',
      mockFetch,
    );

    assert.equal(result.ok, false);
  });

  it('accepts image/png, image/webp, image/avif (bitmap formats)', async () => {
    for (const ct of ['image/png', 'image/webp', 'image/avif']) {
      const mockFetch = makeMockFetch([
        {
          urlMatches: () => true,
          response: new Response(new Uint8Array([0]), {
            status: 200,
            headers: { 'content-type': ct },
          }),
        },
      ]);

      const result = await fetchUpstream(
        'https://s1.ticketm.net/x',
        mockFetch,
      );

      assert.equal(result.ok, true, `${ct} should be allowed`);
    }
  });
});
