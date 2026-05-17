/**
 * Unit tests for itunes.ts — preview-clip fallback for the row-play
 * button. Stubs globalThis.fetch with canned iTunes Search responses;
 * no real Apple API calls happen.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ITunesError, searchTrackPreview } from '../itunes';

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

describe('searchTrackPreview — happy path', () => {
  it('returns the top song-kind result with its preview URL', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse({
        resultCount: 1,
        results: [
          {
            artistName: 'No Doubt',
            trackName: 'Tragic Kingdom',
            previewUrl: 'https://audio-ssl.itunes.apple.com/preview-1.m4a',
            trackTimeMillis: 331667,
            kind: 'song',
          },
        ],
      });
    }) as typeof globalThis.fetch;

    const result = await searchTrackPreview('No Doubt', 'Tragic Kingdom');
    assert.ok(result);
    assert.equal(result.artist, 'No Doubt');
    assert.equal(result.title, 'Tragic Kingdom');
    assert.equal(result.previewUrl, 'https://audio-ssl.itunes.apple.com/preview-1.m4a');
    assert.equal(result.durationMs, 331667);
    // Query string includes both artist + title joined by space, plus the
    // song-entity filter that scopes results away from music-videos.
    assert.match(capturedUrl, /term=No%20Doubt%20Tragic%20Kingdom/);
    assert.match(capturedUrl, /entity=song/);
  });

  it('returns null durationMs when iTunes omits trackTimeMillis', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        resultCount: 1,
        results: [
          {
            artistName: 'X',
            trackName: 'Y',
            previewUrl: 'https://audio/y.m4a',
            kind: 'song',
          },
        ],
      })) as typeof globalThis.fetch;

    const result = await searchTrackPreview('X', 'Y');
    assert.ok(result);
    assert.equal(result.durationMs, null);
  });
});

describe('searchTrackPreview — empty / non-song / no-preview', () => {
  it('returns null when iTunes has no results for the query', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ resultCount: 0, results: [] })) as typeof globalThis.fetch;

    const result = await searchTrackPreview('Unknown Artist', 'Unknown Song');
    assert.equal(result, null);
  });

  it('returns null when the top result is not a song (e.g. music-video)', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        resultCount: 1,
        results: [
          {
            artistName: 'X',
            trackName: 'Y',
            previewUrl: 'https://audio/y.m4a',
            kind: 'music-video',
          },
        ],
      })) as typeof globalThis.fetch;

    const result = await searchTrackPreview('X', 'Y');
    assert.equal(result, null);
  });

  it('returns null when the song result has no previewUrl', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        resultCount: 1,
        results: [
          {
            artistName: 'X',
            trackName: 'Y',
            kind: 'song',
          },
        ],
      })) as typeof globalThis.fetch;

    const result = await searchTrackPreview('X', 'Y');
    assert.equal(result, null);
  });

  it('returns null when artist+title are both empty', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return jsonResponse({ resultCount: 0, results: [] });
    }) as typeof globalThis.fetch;

    const result = await searchTrackPreview('', '');
    assert.equal(result, null);
    assert.equal(called, false, 'should short-circuit before fetch');
  });
});

describe('searchTrackPreview — error paths', () => {
  it('throws ITunesError(403) when Apple rate-limits the IP', async () => {
    globalThis.fetch = (async () =>
      new Response('rate limited', { status: 403 })) as typeof globalThis.fetch;

    await assert.rejects(
      () => searchTrackPreview('X', 'Y'),
      (err: unknown) => {
        assert.ok(err instanceof ITunesError);
        assert.equal(err.status, 403);
        return true;
      },
    );
  });

  it('returns null on non-OK / non-403 responses without throwing', async () => {
    globalThis.fetch = (async () =>
      new Response('server error', { status: 500 })) as typeof globalThis.fetch;

    const result = await searchTrackPreview('X', 'Y');
    assert.equal(result, null);
  });

  it('returns null on network errors (does not throw)', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;

    const result = await searchTrackPreview('X', 'Y');
    assert.equal(result, null);
  });

  it('returns null when iTunes responds with non-JSON body', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>not json</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as typeof globalThis.fetch;

    const result = await searchTrackPreview('X', 'Y');
    assert.equal(result, null);
  });
});
