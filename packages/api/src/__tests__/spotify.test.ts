/**
 * Unit tests for spotify.ts. Stubs globalThis.fetch with canned
 * responses; no real Spotify API calls happen.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyError, getFollowedArtists } from '../spotify';

let origFetch: typeof globalThis.fetch;

beforeEach(() => {
  origFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SpotifyError', () => {
  it('captures message + status + detail', () => {
    const err = new SpotifyError('boom', 401, 'expired');
    assert.equal(err.name, 'SpotifyError');
    assert.equal(err.message, 'boom');
    assert.equal(err.status, 401);
    assert.equal(err.detail, 'expired');
    assert.ok(err instanceof Error);
  });
});

describe('getFollowedArtists', () => {
  it('returns artists from a single page', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        artists: {
          items: [
            {
              id: 'a1',
              name: 'Phoebe Bridgers',
              images: [
                { url: 'https://img/a1-large.jpg', width: 640 },
                { url: 'https://img/a1-medium.jpg', width: 320 },
                { url: 'https://img/a1-small.jpg', width: 160 },
              ],
              genres: ['indie folk'],
            },
          ],
          next: null,
        },
      })) as typeof globalThis.fetch;

    const result = await getFollowedArtists('token-abc');
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, 'a1');
    assert.equal(result[0]?.name, 'Phoebe Bridgers');
    // Picks the image closest to 320px wide
    assert.equal(result[0]?.imageUrl, 'https://img/a1-medium.jpg');
    assert.deepEqual(result[0]?.genres, ['indie folk']);
  });

  it('pages through `next` URLs and concatenates', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          artists: {
            items: [{ id: 'a1', name: 'One', images: [], genres: [] }],
            next: 'https://api.spotify.com/v1/me/following?type=artist&after=a1&limit=50',
          },
        });
      }
      return jsonResponse({
        artists: {
          items: [{ id: 'a2', name: 'Two', images: [], genres: [] }],
          next: null,
        },
      });
    }) as typeof globalThis.fetch;

    const result = await getFollowedArtists('token');
    assert.equal(result.length, 2);
    assert.equal(result[0]?.id, 'a1');
    assert.equal(result[1]?.id, 'a2');
    assert.equal(calls, 2);
  });

  it('passes Bearer token in Authorization header', async () => {
    let capturedAuth = '';
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      return jsonResponse({ artists: { items: [], next: null } });
    }) as typeof globalThis.fetch;

    await getFollowedArtists('my-secret-token');
    assert.equal(capturedAuth, 'Bearer my-secret-token');
  });

  it('handles missing image and genres arrays', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        artists: {
          items: [{ id: 'a1', name: 'Bare' }],
          next: null,
        },
      })) as typeof globalThis.fetch;

    const result = await getFollowedArtists('t');
    assert.equal(result[0]?.imageUrl, null);
    assert.deepEqual(result[0]?.genres, []);
  });

  it('throws SpotifyError on non-OK response', async () => {
    globalThis.fetch = (async () =>
      new Response('expired', { status: 401 })) as typeof globalThis.fetch;

    await assert.rejects(
      getFollowedArtists('expired-token'),
      (err: SpotifyError) => {
        assert.equal(err.name, 'SpotifyError');
        assert.equal(err.status, 401);
        assert.equal(err.detail, 'expired');
        return true;
      },
    );
  });

  it('caps at 1000 artists even if Spotify keeps paging', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        artists: {
          // 50 items per page, infinite next
          items: Array.from({ length: 50 }, (_, i) => ({
            id: `a${i}`,
            name: `Artist ${i}`,
            images: [],
            genres: [],
          })),
          next: 'https://api.spotify.com/v1/me/following?type=artist&after=x&limit=50',
        },
      })) as typeof globalThis.fetch;

    const result = await getFollowedArtists('t');
    assert.equal(result.length, 1000);
  });
});
