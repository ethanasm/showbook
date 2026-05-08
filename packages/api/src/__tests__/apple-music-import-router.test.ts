/**
 * Unit tests for the apple-music-import tRPC router. We stub
 * `globalThis.fetch` URL-by-URL to mock the Apple Music library-artists
 * API and Ticketmaster attraction search; ctx.db is the in-memory fake.
 *
 * Coverage focus mirrors spotify-import-router.test.ts: enrichment +
 * already-followed bookkeeping, rate-limit guards, error-mapping, plus
 * the apple-music-only PRECONDITION_FAILED path when developer-token
 * env vars are missing.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { appleMusicImportRouter } from '../routers/apple-music-import';
import { _resetDeveloperTokenCacheForTests } from '../apple-music';
import { enforceRateLimit } from '../rate-limit';
import { fakeCtx, makeFakeDb, type FakeDb } from './_fake-db';

function caller(db: FakeDb, userId = 'apple-test-user') {
  return appleMusicImportRouter.createCaller(fakeCtx(db, userId) as never);
}

let origFetch: typeof globalThis.fetch;
const ENV_KEYS = [
  'APPLE_MUSIC_TEAM_ID',
  'APPLE_MUSIC_KEY_ID',
  'APPLE_MUSIC_PRIVATE_KEY',
  'TICKETMASTER_API_KEY',
] as const;
const origEnv: Record<string, string | undefined> = {};

function setupAppleEnv() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.APPLE_MUSIC_TEAM_ID = 'TEAM';
  process.env.APPLE_MUSIC_KEY_ID = 'KEY';
  process.env.APPLE_MUSIC_PRIVATE_KEY = privateKey
    .export({ format: 'pem', type: 'pkcs8' })
    .toString();
}

beforeEach(() => {
  origFetch = globalThis.fetch;
  for (const k of ENV_KEYS) origEnv[k] = process.env[k];
  process.env.TICKETMASTER_API_KEY = 'test-tm-key';
  setupAppleEnv();
  _resetDeveloperTokenCacheForTests();
});
afterEach(() => {
  globalThis.fetch = origFetch;
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
  _resetDeveloperTokenCacheForTests();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setupFetchMock(opts: {
  appleArtists: Array<{ id: string; name: string }>;
  tmAttractionsByQuery: Record<
    string,
    Array<{
      id: string;
      name: string;
      images?: unknown[];
      externalLinks?: { musicbrainz?: Array<{ id: string }> };
    }>
  >;
  appleStatus?: number;
}) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    const hostname = new URL(url).hostname;
    if (hostname === 'api.music.apple.com') {
      if (opts.appleStatus && opts.appleStatus !== 200) {
        return new Response('err', { status: opts.appleStatus });
      }
      return jsonResponse({
        data: opts.appleArtists.map((a) => ({
          id: a.id,
          type: 'library-artists',
          attributes: { name: a.name },
        })),
      });
    }
    if (hostname === 'app.ticketmaster.com') {
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

describe('appleMusicImportRouter.listFollowed', () => {
  it('rejects empty music-user token (zod min(1))', async () => {
    const db = makeFakeDb();
    await assert.rejects(() =>
      caller(db).listFollowed({ musicUserToken: '' }),
    );
  });

  it('returns enriched artist list with TM matches and follow status', async () => {
    setupFetchMock({
      appleArtists: [
        { id: 'r.phoebe', name: 'Phoebe Bridgers' },
        { id: 'r.unknown', name: 'Unknown Indie Band' },
      ],
      tmAttractionsByQuery: {
        'Phoebe Bridgers': [{ id: 'tm1', name: 'Phoebe Bridgers', images: [] }],
        'Unknown Indie Band': [],
      },
    });
    const db = makeFakeDb({
      selectResults: [[{ tmAttractionId: 'tm1' }]],
    });

    const result = await caller(db, 'list-user-1').listFollowed({
      musicUserToken: 'mut-token',
    });

    assert.equal(result.artists.length, 2);
    assert.equal(result.totalCount, 2);
    assert.equal(result.resolvedCount, 2);
    assert.equal(result.truncated, false);

    const phoebe = result.artists.find((a) => a.appleMusicId === 'r.phoebe');
    assert.ok(phoebe?.tmMatch, 'Phoebe should have TM match');
    assert.equal(phoebe?.tmMatch?.tmAttractionId, 'tm1');
    assert.equal(phoebe?.alreadyFollowed, true);

    const unknown = result.artists.find((a) => a.appleMusicId === 'r.unknown');
    assert.equal(unknown?.tmMatch, null);
    assert.equal(unknown?.alreadyFollowed, false);
  });

  it('sends Music-User-Token and developer-token Authorization header', async () => {
    const { calls } = setupFetchMock({
      appleArtists: [],
      tmAttractionsByQuery: {},
    });
    const db = makeFakeDb();
    await caller(db).listFollowed({ musicUserToken: 'my-mut' });

    const appleCall = calls.find(
      (c) => new URL(c.url).hostname === 'api.music.apple.com',
    );
    assert.ok(appleCall, 'expected an Apple Music call');
    assert.equal(appleCall!.headers!['Music-User-Token'], 'my-mut');
    assert.match(appleCall!.headers!['Authorization']!, /^Bearer .+\..+\..+$/);
  });

  it('maps Apple Music 401 to UNAUTHORIZED', async () => {
    setupFetchMock({
      appleArtists: [],
      tmAttractionsByQuery: {},
      appleStatus: 401,
    });
    const db = makeFakeDb();
    await assert.rejects(
      () => caller(db).listFollowed({ musicUserToken: 'expired' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'UNAUTHORIZED',
    );
  });

  it('returns PRECONDITION_FAILED when developer-token env vars are missing', async () => {
    delete process.env.APPLE_MUSIC_TEAM_ID;
    delete process.env.APPLE_MUSIC_KEY_ID;
    delete process.env.APPLE_MUSIC_PRIVATE_KEY;
    _resetDeveloperTokenCacheForTests();
    const db = makeFakeDb();
    await assert.rejects(
      () => caller(db).listFollowed({ musicUserToken: 'tok' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'PRECONDITION_FAILED',
    );
  });

  it('throws TOO_MANY_REQUESTS when rate-limit bucket is exhausted', async () => {
    const userId = 'apple-rate-list';
    for (let i = 0; i < 5; i++) {
      enforceRateLimit(`appleMusic.list:${userId}`, {
        max: 5,
        windowMs: 60_000,
      });
    }
    const db = makeFakeDb();
    await assert.rejects(
      () => caller(db, userId).listFollowed({ musicUserToken: 't' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('exposes the TM musicbrainzId on tmMatch when present', async () => {
    setupFetchMock({
      appleArtists: [{ id: 'r.phoebe', name: 'Phoebe Bridgers' }],
      tmAttractionsByQuery: {
        'Phoebe Bridgers': [
          {
            id: 'tm1',
            name: 'Phoebe Bridgers',
            images: [],
            externalLinks: { musicbrainz: [{ id: 'mbid-phoebe' }] },
          },
        ],
      },
    });
    const db = makeFakeDb({ selectResults: [[]] });
    const result = await caller(db).listFollowed({ musicUserToken: 't' });
    assert.equal(result.artists[0]?.tmMatch?.musicbrainzId, 'mbid-phoebe');
  });

  it('handles empty Apple Music library without hitting TM', async () => {
    const { calls } = setupFetchMock({
      appleArtists: [],
      tmAttractionsByQuery: {},
    });
    const db = makeFakeDb();
    const result = await caller(db, 'empty-user').listFollowed({
      musicUserToken: 'tok',
    });

    assert.equal(result.artists.length, 0);
    assert.equal(result.totalCount, 0);
    // Only the Apple Music call, no TM lookups
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /api\.music\.apple\.com/);
  });
});

describe('appleMusicImportRouter.importSelected', () => {
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
    const userId = 'apple-rate-import';
    for (let i = 0; i < 3; i++) {
      enforceRateLimit(`appleMusic.import:${userId}`, {
        max: 3,
        windowMs: 60_000,
      });
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
