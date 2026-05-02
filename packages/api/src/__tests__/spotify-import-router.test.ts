/**
 * Unit tests for the spotify-import tRPC router. We stub
 * `globalThis.fetch` URL-by-URL to mock the Spotify followed-artists API
 * and Ticketmaster attraction search; ctx.db is the in-memory fake.
 *
 * Coverage focus: the listFollowed enrichment path (TM resolution +
 * already-followed bookkeeping), the rate-limit guards, and the early
 * zod / error mappings. importSelected's deep DB integration (which
 * passes through matchOrCreatePerformer's real-db transaction) is left
 * to higher-level integration tests.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { spotifyImportRouter } from '../routers/spotify-import';
import { enforceRateLimit } from '../rate-limit';
import { fakeCtx, makeFakeDb, type FakeDb } from './_fake-db';

function caller(db: FakeDb, userId = 'spotify-test-user') {
  return spotifyImportRouter.createCaller(fakeCtx(db, userId) as never);
}

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

/**
 * Dispatch fetch calls based on URL host: Spotify followed-artists vs
 * Ticketmaster attraction search. Returns canned data per call.
 */
function setupFetchMock(opts: {
  spotifyArtists: Array<{ id: string; name: string }>;
  tmAttractionsByQuery: Record<
    string,
    Array<{
      id: string;
      name: string;
      images?: unknown[];
      externalLinks?: { musicbrainz?: Array<{ id: string }> };
    }>
  >;
  spotifyStatus?: number;
}) {
  const calls: { url: string }[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push({ url });
    if (url.includes('api.spotify.com')) {
      if (opts.spotifyStatus && opts.spotifyStatus !== 200) {
        return new Response('err', { status: opts.spotifyStatus });
      }
      return jsonResponse({
        artists: {
          items: opts.spotifyArtists.map((a) => ({
            ...a,
            images: [],
            genres: [],
          })),
          next: null,
        },
      });
    }
    if (url.includes('app.ticketmaster.com')) {
      const m = url.match(/keyword=([^&]+)/);
      const keyword = m ? decodeURIComponent(m[1]!.replace(/\+/g, ' ')) : '';
      const attractions = opts.tmAttractionsByQuery[keyword] ?? [];
      return jsonResponse({
        _embedded: { attractions },
        page: { size: 20, totalElements: attractions.length, totalPages: 1, number: 0 },
      });
    }
    throw new Error(`Unmocked URL: ${url}`);
  }) as typeof globalThis.fetch;
  return { calls };
}

describe('spotifyImportRouter.listFollowed', () => {
  it('rejects empty access token (zod min(1))', async () => {
    const db = makeFakeDb();
    await assert.rejects(() => caller(db).listFollowed({ accessToken: '' }));
  });

  it('returns enriched artist list with TM matches and follow status', async () => {
    setupFetchMock({
      spotifyArtists: [
        { id: 'sp1', name: 'Phoebe Bridgers' },
        { id: 'sp2', name: 'Unknown Indie Band' },
      ],
      tmAttractionsByQuery: {
        'Phoebe Bridgers': [
          { id: 'tm1', name: 'Phoebe Bridgers', images: [] },
        ],
        'Unknown Indie Band': [],
      },
    });

    // ctx.db.select() will be called once with the followed-performer
    // join. Script it to return one row indicating tm1 is already followed.
    const db = makeFakeDb({
      selectResults: [[{ tmAttractionId: 'tm1' }]],
    });

    const result = await caller(db, 'list-user-1').listFollowed({
      accessToken: 'valid-token',
    });

    assert.equal(result.artists.length, 2);
    assert.equal(result.totalCount, 2);
    assert.equal(result.resolvedCount, 2);
    assert.equal(result.truncated, false);

    const phoebe = result.artists.find((a) => a.spotifyId === 'sp1');
    assert.ok(phoebe?.tmMatch, 'Phoebe should have TM match');
    assert.equal(phoebe?.tmMatch?.tmAttractionId, 'tm1');
    assert.equal(phoebe?.alreadyFollowed, true);

    const unknown = result.artists.find((a) => a.spotifyId === 'sp2');
    assert.equal(unknown?.tmMatch, null);
    assert.equal(unknown?.alreadyFollowed, false);
  });

  it('skips fuzzy TM matches that do not match by name', async () => {
    setupFetchMock({
      spotifyArtists: [{ id: 'sp1', name: 'The XX' }],
      tmAttractionsByQuery: {
        'The XX': [
          { id: 'tm-other', name: 'XX Tribute Band', images: [] },
        ],
      },
    });

    const db = makeFakeDb({ selectResults: [[]] });
    const result = await caller(db).listFollowed({ accessToken: 'tok' });

    assert.equal(result.artists.length, 1);
    assert.equal(result.artists[0]?.tmMatch, null);
  });

  it('maps Spotify 401 to UNAUTHORIZED', async () => {
    setupFetchMock({
      spotifyArtists: [],
      tmAttractionsByQuery: {},
      spotifyStatus: 401,
    });

    const db = makeFakeDb();
    await assert.rejects(
      () => caller(db).listFollowed({ accessToken: 'expired' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'UNAUTHORIZED',
    );
  });

  it('throws TOO_MANY_REQUESTS when rate-limit bucket is exhausted', async () => {
    const userId = 'rate-list';
    for (let i = 0; i < 5; i++) {
      enforceRateLimit(`spotify.list:${userId}`, { max: 5, windowMs: 60_000 });
    }
    const db = makeFakeDb();
    await assert.rejects(
      () => caller(db, userId).listFollowed({ accessToken: 't' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('exposes the TM musicbrainzId on tmMatch when present', async () => {
    setupFetchMock({
      spotifyArtists: [{ id: 'sp1', name: 'Phoebe Bridgers' }],
      tmAttractionsByQuery: {
        'Phoebe Bridgers': [
          {
            id: 'tm1',
            name: 'Phoebe Bridgers',
            images: [],
            externalLinks: {
              musicbrainz: [{ id: 'mbid-phoebe-bridgers' }],
            },
          },
        ],
      },
    });
    const db = makeFakeDb({ selectResults: [[]] });
    const result = await caller(db).listFollowed({ accessToken: 'tok' });
    assert.equal(result.artists[0]?.tmMatch?.musicbrainzId, 'mbid-phoebe-bridgers');
  });

  it('returns musicbrainzId=null when TM has no MusicBrainz external link', async () => {
    setupFetchMock({
      spotifyArtists: [{ id: 'sp1', name: 'Sam Short' }],
      tmAttractionsByQuery: {
        'Sam Short': [{ id: 'tm-sam-short', name: 'Sam Short', images: [] }],
      },
    });
    const db = makeFakeDb({ selectResults: [[]] });
    const result = await caller(db).listFollowed({ accessToken: 'tok' });
    assert.equal(result.artists[0]?.tmMatch?.tmAttractionId, 'tm-sam-short');
    assert.equal(result.artists[0]?.tmMatch?.musicbrainzId, null);
  });

  it('handles empty Spotify follow list without hitting TM', async () => {
    const { calls } = setupFetchMock({
      spotifyArtists: [],
      tmAttractionsByQuery: {},
    });

    const db = makeFakeDb();
    const result = await caller(db, 'empty-user').listFollowed({
      accessToken: 'tok',
    });

    assert.equal(result.artists.length, 0);
    assert.equal(result.totalCount, 0);
    // Only the Spotify call, no TM lookups
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /api\.spotify\.com/);
  });
});

describe('spotifyImportRouter.importSelected', () => {
  it('rejects empty artists array', async () => {
    const db = makeFakeDb();
    await assert.rejects(() =>
      caller(db).importSelected({ artists: [] }),
    );
  });

  it('rejects artists with empty tmAttractionId or name', async () => {
    const db = makeFakeDb();
    await assert.rejects(() =>
      caller(db).importSelected({
        artists: [{ tmAttractionId: '', name: 'X' }],
      }),
    );
    await assert.rejects(() =>
      caller(db).importSelected({
        artists: [{ tmAttractionId: 'tm1', name: '' }],
      }),
    );
  });

  it('rejects more than 500 artists', async () => {
    const db = makeFakeDb();
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      tmAttractionId: `tm${i}`,
      name: `Artist ${i}`,
    }));
    await assert.rejects(() =>
      caller(db).importSelected({ artists: tooMany }),
    );
  });

  it('throws TOO_MANY_REQUESTS when rate-limit bucket is exhausted', async () => {
    const userId = 'rate-import';
    for (let i = 0; i < 3; i++) {
      enforceRateLimit(`spotify.import:${userId}`, { max: 3, windowMs: 60_000 });
    }
    const db = makeFakeDb();
    await assert.rejects(
      () =>
        caller(db, userId).importSelected({
          artists: [{ tmAttractionId: 'tm1', name: 'X' }],
        }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });
});
