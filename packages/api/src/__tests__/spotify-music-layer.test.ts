/**
 * Unit tests for the Phase 7 music-layer helpers — fan-loyalty,
 * discovered-live, and the cache wrapper around tracksContains.
 *
 * The DB is mocked at module level so we don't need an integration
 * scaffold for the gate logic and per-show numerator math. The
 * Spotify `tracksContains` call is intercepted via a mock fetch.
 */

import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as realDb from '@showbook/db';

interface DbState {
  showRow: unknown;
  songRows: Array<{
    id: string;
    title: string;
    spotifyTrackId: string | null;
    firstKnownPerformance: string | null;
  }>;
  spotifyTokenRow: { accessTokenEnc?: string | null; expiresAt?: Date; revokedAt?: Date | null } | null;
  /**
   * Optional FIFO queue overriding `songRows` for tests that need to
   * stub multiple distinct `select()` results in sequence (e.g.
   * `saveDiscoveredSong` does an ownership lookup followed by a
   * songs-row lookup). Each `select()` shifts one result off the
   * queue; when null the legacy `songRows` path is used.
   */
  selectQueue: unknown[] | null;
}

const DB_STATE: DbState = {
  showRow: null,
  songRows: [],
  spotifyTokenRow: null,
  selectQueue: null,
};

function makeChain(getResult: () => unknown) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') {
        const value = getResult();
        return (resolve: (v: unknown) => unknown) =>
          Promise.resolve(value).then(resolve);
      }
      return () => proxy;
    },
  };
  const proxy: object = new Proxy({}, handler);
  return proxy;
}

const fakeDb = {
  query: {
    shows: {
      findFirst: async () => DB_STATE.showRow,
    },
  },
  select: () =>
    makeChain(() => {
      if (DB_STATE.selectQueue !== null) {
        return DB_STATE.selectQueue.shift() ?? [];
      }
      return DB_STATE.songRows;
    }),
  update: () =>
    makeChain(() => {
      return [];
    }),
  insert: () => makeChain(() => []),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};

mock.module('@showbook/db', {
  namedExports: { ...realDb, db: fakeDb },
});

// `ensureFreshUserToken` is also stubbed so we can simulate connected /
// disconnected users without standing up an encrypted token row.
let nextAccessToken: string | null = 'fake-access-token';
mock.module('../spotify-tokens', {
  namedExports: {
    ensureFreshUserToken: async () => nextAccessToken,
    isSpotifyConnected: async () => Boolean(nextAccessToken),
    getConnectionStatus: async () => ({
      connected: Boolean(nextAccessToken),
    }),
    persistInitialToken: async () => undefined,
    disconnectSpotify: async () => undefined,
  },
});

let musicLayer: typeof import('../spotify-music-layer');
let origFetch: typeof globalThis.fetch;

before(async () => {
  musicLayer = await import('../spotify-music-layer');
});

beforeEach(() => {
  origFetch = globalThis.fetch;
  DB_STATE.showRow = null;
  DB_STATE.songRows = [];
  DB_STATE.selectQueue = null;
  nextAccessToken = 'fake-access-token';
  musicLayer.__resetSavedCacheForTests();
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

function makeShowRow(opts: {
  headlinerId: string;
  setlistTitles: string[];
}) {
  return {
    id: 'show-1',
    userId: 'user-1',
    kind: 'concert',
    state: 'past',
    date: '2026-04-12',
    setlist: opts.setlistTitles,
    setlists: null,
    showPerformers: [
      {
        role: 'headliner',
        sortOrder: 0,
        performer: { id: opts.headlinerId, name: 'Test Artist' },
      },
    ],
  };
}

describe('checkTracksSavedForUser', () => {
  it('returns empty Map for empty input without calling Spotify', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse([]);
    }) as typeof globalThis.fetch;
    const result = await musicLayer.checkTracksSavedForUser(
      'user-1',
      'token',
      [],
    );
    assert.equal(result.size, 0);
    assert.equal(calls, 0);
  });

  it('caches per-(user, track) for 60s — repeat call makes no extra fetch', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse([true, false]);
    }) as typeof globalThis.fetch;
    const first = await musicLayer.checkTracksSavedForUser(
      'user-1',
      'token',
      ['t1', 't2'],
    );
    assert.equal(first.get('t1'), true);
    assert.equal(first.get('t2'), false);
    assert.equal(calls, 1);
    const second = await musicLayer.checkTracksSavedForUser(
      'user-1',
      'token',
      ['t1', 't2'],
    );
    assert.equal(second.get('t1'), true);
    assert.equal(second.get('t2'), false);
    // Cache absorbed the second call entirely.
    assert.equal(calls, 1);
  });

  it('mixes cached and to-fetch ids without losing order', async () => {
    let captured: string[] = [];
    globalThis.fetch = (async (url: string) => {
      const m = url.match(/ids=([^&]+)/);
      captured = m ? decodeURIComponent(m[1]!).split(',') : [];
      return jsonResponse(captured.map(() => true));
    }) as typeof globalThis.fetch;
    await musicLayer.checkTracksSavedForUser('user-1', 'token', ['t1']);
    captured = [];
    await musicLayer.checkTracksSavedForUser('user-1', 'token', ['t1', 't2']);
    // Second call should only fetch t2 — t1 came from cache.
    assert.deepEqual(captured, ['t2']);
  });
});

describe('fanLoyaltyForShow', () => {
  it('returns disconnected state when no Spotify token', async () => {
    nextAccessToken = null;
    DB_STATE.showRow = makeShowRow({
      headlinerId: 'perf-1',
      setlistTitles: ['One', 'Two'],
    });
    DB_STATE.songRows = [
      { id: 'song-1', title: 'One', spotifyTrackId: 'tr1', firstKnownPerformance: '2020-01-01' },
      { id: 'song-2', title: 'Two', spotifyTrackId: 'tr2', firstKnownPerformance: '2021-01-01' },
    ];
    const result = await musicLayer.fanLoyaltyForShow({
      db: fakeDb as unknown as realDb.Database,
      userId: 'user-1',
      showId: 'show-1',
    });
    assert.equal(result.connected, false);
    assert.equal(result.totalCount, 2);
    assert.equal(result.savedCount, 0);
  });

  it('returns no-data state when setlist has no resolved Spotify ids', async () => {
    DB_STATE.showRow = makeShowRow({
      headlinerId: 'perf-1',
      setlistTitles: ['One'],
    });
    DB_STATE.songRows = [
      { id: 'song-1', title: 'One', spotifyTrackId: null, firstKnownPerformance: null },
    ];
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return jsonResponse([]);
    }) as typeof globalThis.fetch;
    const result = await musicLayer.fanLoyaltyForShow({
      db: fakeDb as unknown as realDb.Database,
      userId: 'user-1',
      showId: 'show-1',
    });
    assert.equal(result.noData, true);
    assert.equal(result.totalCount, 0);
    // No fetch — we had nothing to ask about.
    assert.equal(fetchCount, 0);
  });

  it('counts saved/total against Spotify response', async () => {
    DB_STATE.showRow = makeShowRow({
      headlinerId: 'perf-1',
      setlistTitles: ['One', 'Two', 'Three'],
    });
    DB_STATE.songRows = [
      { id: 'song-1', title: 'One', spotifyTrackId: 'tr1', firstKnownPerformance: '2020-01-01' },
      { id: 'song-2', title: 'Two', spotifyTrackId: 'tr2', firstKnownPerformance: '2020-01-01' },
      { id: 'song-3', title: 'Three', spotifyTrackId: 'tr3', firstKnownPerformance: '2020-01-01' },
    ];
    globalThis.fetch = (async () =>
      jsonResponse([true, false, true])) as typeof globalThis.fetch;
    const result = await musicLayer.fanLoyaltyForShow({
      db: fakeDb as unknown as realDb.Database,
      userId: 'user-1',
      showId: 'show-1',
    });
    assert.equal(result.connected, true);
    assert.equal(result.totalCount, 3);
    assert.equal(result.savedCount, 2);
    assert.equal(result.artistName, 'Test Artist');
    assert.equal(result.playedCount, 3);
  });

  it('skips negative-sentinel spotify ids in the count', async () => {
    DB_STATE.showRow = makeShowRow({
      headlinerId: 'perf-1',
      setlistTitles: ['One', 'Two'],
    });
    DB_STATE.songRows = [
      { id: 'song-1', title: 'One', spotifyTrackId: 'tr1', firstKnownPerformance: null },
      { id: 'song-2', title: 'Two', spotifyTrackId: '__none__', firstKnownPerformance: null },
    ];
    globalThis.fetch = (async () =>
      jsonResponse([true])) as typeof globalThis.fetch;
    const result = await musicLayer.fanLoyaltyForShow({
      db: fakeDb as unknown as realDb.Database,
      userId: 'user-1',
      showId: 'show-1',
    });
    assert.equal(result.totalCount, 1);
    assert.equal(result.savedCount, 1);
    assert.equal(result.playedCount, 2);
  });
});

describe('discoveredLiveForShow', () => {
  it('returns saved flags per track', async () => {
    DB_STATE.showRow = makeShowRow({
      headlinerId: 'perf-1',
      setlistTitles: ['One', 'Two'],
    });
    DB_STATE.songRows = [
      { id: 'song-1', title: 'One', spotifyTrackId: 'tr1', firstKnownPerformance: '2020-01-01' },
      { id: 'song-2', title: 'Two', spotifyTrackId: 'tr2', firstKnownPerformance: '2022-06-01' },
    ];
    globalThis.fetch = (async () =>
      jsonResponse([true, false])) as typeof globalThis.fetch;
    const result = await musicLayer.discoveredLiveForShow({
      db: fakeDb as unknown as realDb.Database,
      userId: 'user-1',
      showId: 'show-1',
    });
    assert.equal(result.connected, true);
    assert.equal(result.tracks.length, 2);
    assert.deepEqual(
      result.tracks.map((t) => ({ id: t.spotifyTrackId, saved: t.saved })),
      [
        { id: 'tr1', saved: true },
        { id: 'tr2', saved: false },
      ],
    );
    assert.equal(result.tracks[1]?.year, 2022);
  });

  it('returns empty when no resolvable Spotify ids', async () => {
    DB_STATE.showRow = makeShowRow({
      headlinerId: 'perf-1',
      setlistTitles: ['One'],
    });
    DB_STATE.songRows = [
      { id: 'song-1', title: 'One', spotifyTrackId: null, firstKnownPerformance: null },
    ];
    const result = await musicLayer.discoveredLiveForShow({
      db: fakeDb as unknown as realDb.Database,
      userId: 'user-1',
      showId: 'show-1',
    });
    assert.equal(result.noData, true);
    assert.equal(result.tracks.length, 0);
  });
});

describe('saveDiscoveredSong', () => {
  it('rejects with not_in_user_history when the user has not heard the song live', async () => {
    // First select() — the ownership-check join against
    // setlist_song_appearances + shows — returns no rows, simulating
    // an attacker calling the mutation with a catalog songId that
    // doesn't appear in any of their attended setlists.
    DB_STATE.selectQueue = [[]];
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return jsonResponse({});
    }) as typeof globalThis.fetch;
    const result = await musicLayer.saveDiscoveredSong({
      db: fakeDb as unknown as realDb.Database,
      userId: 'user-1',
      songId: '00000000-0000-4000-8000-00000000abcd',
    });
    assert.deepEqual(result, { ok: false, reason: 'not_in_user_history' });
    // The ownership gate must short-circuit before we ever touch
    // Spotify — otherwise the mutation still leaks "this song exists
    // in the catalog and has a Spotify id" via timing.
    assert.equal(fetchCalled, false);
  });

  it('proceeds when the song appears in one of the caller\'s attended setlists', async () => {
    // First select() — ownership row present. Second select() — the
    // songs-row lookup for the Spotify track id. Third select() —
    // ensureFreshUserToken's stub (returns the access token directly,
    // so no select happens here; the queue can be left short).
    DB_STATE.selectQueue = [
      [{ id: 'appearance-1' }],
      [{ spotifyTrackId: 'tr-x' }],
    ];
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    }) as typeof globalThis.fetch;
    const result = await musicLayer.saveDiscoveredSong({
      db: fakeDb as unknown as realDb.Database,
      userId: 'user-1',
      songId: '00000000-0000-4000-8000-00000000abce',
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 1);
  });

  it('rejects with no_spotify_id when the song exists in user history but has no resolved Spotify id', async () => {
    DB_STATE.selectQueue = [
      [{ id: 'appearance-1' }],
      [{ spotifyTrackId: null }],
    ];
    const result = await musicLayer.saveDiscoveredSong({
      db: fakeDb as unknown as realDb.Database,
      userId: 'user-1',
      songId: '00000000-0000-4000-8000-00000000abcf',
    });
    assert.deepEqual(result, { ok: false, reason: 'no_spotify_id' });
  });

  it('treats the negative `__none__` sentinel as no_spotify_id, not a missing row', async () => {
    DB_STATE.selectQueue = [
      [{ id: 'appearance-1' }],
      [{ spotifyTrackId: '__none__' }],
    ];
    const result = await musicLayer.saveDiscoveredSong({
      db: fakeDb as unknown as realDb.Database,
      userId: 'user-1',
      songId: '00000000-0000-4000-8000-00000000abd0',
    });
    assert.deepEqual(result, { ok: false, reason: 'no_spotify_id' });
  });
});
