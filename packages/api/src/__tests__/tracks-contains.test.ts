/**
 * Unit tests for the Phase 7 `tracksContains` + `saveTracksToLibrary`
 * helpers. Verifies the 40-URIs-per-call batch loop (the Feb 2026
 * generic `/me/library` ceiling), the empty-input short-circuit, that
 * track ids are wrapped to `spotify:track:` URIs, and that results are
 * stitched back into the original input order.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  tracksContains,
  saveTracksToLibrary,
  SpotifyError,
} from '../spotify';

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

describe('tracksContains', () => {
  it('short-circuits on empty input without an HTTP call', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse([]);
    }) as typeof globalThis.fetch;
    const result = await tracksContains('token', []);
    assert.deepEqual(result, []);
    assert.equal(calls, 0);
  });

  it('returns the boolean array for a single batch and uses /me/library/contains with spotify:track: URIs', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return jsonResponse([true, false, true]);
    }) as typeof globalThis.fetch;
    const result = await tracksContains('token', ['a', 'b', 'c']);
    assert.deepEqual(result, [true, false, true]);
    assert.match(capturedUrl, /\/me\/library\/contains\?uris=/);
    // URIs are comma-joined then percent-encoded as a single value.
    const m = capturedUrl.match(/uris=([^&]+)/);
    assert.ok(m, 'uris query param is present');
    assert.deepEqual(decodeURIComponent(m![1]!).split(','), [
      'spotify:track:a',
      'spotify:track:b',
      'spotify:track:c',
    ]);
  });

  it('batches >40 IDs across multiple calls and stitches in order', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `id${i}`);
    let calls = 0;
    const received: string[][] = [];
    globalThis.fetch = (async (url: string) => {
      calls += 1;
      const m = url.match(/uris=([^&]+)/);
      const decoded = m ? decodeURIComponent(m[1]!).split(',') : [];
      received.push(decoded);
      // Encode: ids ending in '0' or '5' are saved.
      return jsonResponse(
        decoded.map((uri) => {
          const id = uri.replace(/^spotify:track:/, '');
          return id.endsWith('0') || id.endsWith('5');
        }),
      );
    }) as typeof globalThis.fetch;
    const result = await tracksContains('token', ids);
    assert.equal(result.length, 100);
    // 100 ids @ 40 per call → 40, 40, 20.
    assert.equal(calls, 3);
    assert.equal(received[0]!.length, 40);
    assert.equal(received[1]!.length, 40);
    assert.equal(received[2]!.length, 20);
    // First batch entries are wrapped to spotify:track: URIs.
    assert.equal(received[0]![0], 'spotify:track:id0');
    // First saved value matches the encoding (id0 ends with '0').
    assert.equal(result[0], true);
    assert.equal(result[1], false);
  });

  it('throws SpotifyError on non-OK response', async () => {
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500 })) as typeof globalThis.fetch;
    await assert.rejects(
      () => tracksContains('token', ['a']),
      (err) => err instanceof SpotifyError && err.status === 500,
    );
  });

  it('throws when Spotify returns an unexpected payload shape', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ unexpected: true })) as typeof globalThis.fetch;
    await assert.rejects(
      () => tracksContains('token', ['a']),
      (err) => err instanceof SpotifyError,
    );
  });
});

describe('saveTracksToLibrary', () => {
  it('issues a PUT /me/library with { uris: ["spotify:track:..."] } in the body', async () => {
    let captured: { method?: string; url?: string; body?: unknown } = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      captured = {
        method: init?.method,
        url,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      };
      return new Response(null, { status: 200 });
    }) as typeof globalThis.fetch;
    await saveTracksToLibrary('token', ['abc']);
    assert.equal(captured.method, 'PUT');
    assert.match(captured.url ?? '', /\/me\/library$/);
    assert.deepEqual(captured.body, { uris: ['spotify:track:abc'] });
  });

  it('short-circuits on empty input', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    }) as typeof globalThis.fetch;
    await saveTracksToLibrary('token', []);
    assert.equal(calls, 0);
  });

  it('throws SpotifyError when Spotify returns non-OK', async () => {
    globalThis.fetch = (async () =>
      new Response('forbidden', { status: 403 })) as typeof globalThis.fetch;
    await assert.rejects(
      () => saveTracksToLibrary('token', ['abc']),
      (err) => err instanceof SpotifyError && err.status === 403,
    );
  });
});
