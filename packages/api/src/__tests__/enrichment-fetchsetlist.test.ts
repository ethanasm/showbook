/**
 * Router-level integration test for `enrichmentRouter.fetchSetlist`.
 *
 * Regression: when setlist.fm returns an artist that hasn't been linked to
 * MusicBrainz, the artist's `mbid` is an empty string. The router used to
 * blindly take `artists[0]!.mbid` and call `searchSetlist('', date)`,
 * which builds `/search/setlists?artistMbid=&date=...`. setlist.fm rejects
 * that with HTTP 400, and the error cascaded to the client as a
 * `TRPCClientError("setlist.fm 400: Bad Request")` — surfaced in the dev
 * overlay on the /add page whenever a past concert was being edited.
 *
 * The fix is at the setlist.fm client boundary: `searchArtist` filters out
 * empty-mbid entries, and `searchSetlist` short-circuits to null instead
 * of constructing a malformed URL. The router observably returns null for
 * an unlinked artist with no 400 propagation.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { enrichmentRouter } from '../routers/enrichment';
import { fakeCtx, makeFakeDb } from './_fake-db';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.SETLISTFM_API_KEY;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function caller(userId: string) {
  return enrichmentRouter.createCaller(
    fakeCtx(makeFakeDb(), userId) as never,
  );
}

describe('enrichmentRouter.fetchSetlist', () => {
  beforeEach(() => {
    process.env.SETLISTFM_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_KEY === undefined) delete process.env.SETLISTFM_API_KEY;
    else process.env.SETLISTFM_API_KEY = ORIGINAL_KEY;
  });

  it('returns null without 400-ing when the matching artist has no MusicBrainz ID', async () => {
    const requested: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      requested.push(u);
      if (u.includes('/search/artists')) {
        // setlist.fm returns artists without an MBID for entries it
        // hasn't linked to MusicBrainz yet.
        return jsonResponse({
          artist: [
            { mbid: '', name: 'Brand New Band', sortName: 'Brand New Band' },
          ],
          total: 1,
          page: 1,
          itemsPerPage: 30,
        });
      }
      if (u.includes('/search/setlists')) {
        // Old buggy code reaches here with `artistMbid=` and gets 400.
        return new Response('Bad Request', {
          status: 400,
          statusText: 'Bad Request',
        });
      }
      return new Response('unexpected', { status: 500 });
    }) as typeof globalThis.fetch;

    const result = await caller('fetchsetlist-empty-mbid').fetchSetlist({
      performerName: 'Brand New Band',
      date: '2024-01-15',
    });

    assert.equal(result, null);
    assert.ok(
      requested.every((u) => !u.includes('/search/setlists')),
      `must not call /search/setlists with an empty artistMbid; got: ${requested.join(', ')}`,
    );
  });

  it('returns the setlist when the matching artist has an MBID', async () => {
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/search/artists')) {
        return jsonResponse({
          artist: [
            { mbid: 'mb-radiohead', name: 'Radiohead', sortName: 'Radiohead' },
          ],
          total: 1,
          page: 1,
          itemsPerPage: 30,
        });
      }
      if (u.includes('/search/setlists')) {
        assert.ok(
          u.includes('artistMbid=mb-radiohead'),
          `expected mbid in setlist URL, got: ${u}`,
        );
        return jsonResponse({
          setlist: [
            {
              id: 'set-1',
              eventDate: '15-01-2024',
              artist: { mbid: 'mb-radiohead', name: 'Radiohead' },
              venue: {
                id: 'v',
                name: 'MSG',
                city: { id: 'c', name: 'NYC', country: { code: 'US', name: 'US' } },
              },
              tour: { name: 'A Moon Shaped Pool' },
              sets: { set: [{ song: [{ name: 'Daydreaming' }, { name: 'Idioteque' }] }] },
            },
          ],
          total: 1,
          page: 1,
          itemsPerPage: 30,
        });
      }
      return new Response('unexpected', { status: 500 });
    }) as typeof globalThis.fetch;

    const result = await caller('fetchsetlist-happy').fetchSetlist({
      performerName: 'Radiohead',
      date: '2024-01-15',
    });

    assert.deepEqual(result, {
      songs: ['Daydreaming', 'Idioteque'],
      tourName: 'A Moon Shaped Pool',
      mbid: 'mb-radiohead',
    });
  });

  it('returns null when no matching artist is found', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ artist: [], total: 0, page: 1, itemsPerPage: 30 })) as typeof globalThis.fetch;

    const result = await caller('fetchsetlist-noartist').fetchSetlist({
      performerName: 'Nobody In Particular',
      date: '2024-01-15',
    });
    assert.equal(result, null);
  });
});
