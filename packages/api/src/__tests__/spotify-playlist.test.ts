/**
 * Unit tests for `spotify-playlist.ts`. Covers the pure helpers
 * (name + description templates, scope diff) and the side-effecting
 * `resolveTrackUris` path with a stubbed fetch + a mocked `@showbook/db`
 * for the `songs.spotify_track_id` short-circuit.
 *
 * Integration coverage for the full `createHypePlaylist` flow against
 * a real Postgres lives in
 * `spotify-playlist-create.integration.test.ts`.
 */

import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as realDb from '@showbook/db';

interface DbScript {
  songRows: Array<{
    id: string;
    spotifyTrackId: string | null;
    durationMs: number | null;
  }>;
}

const DB_SCRIPT: DbScript = { songRows: [] };

function mkSelectChain(getResult: () => unknown) {
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
  select: () => mkSelectChain(() => DB_SCRIPT.songRows),
  insert: () => {
    const handler: ProxyHandler<object> = {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve([]).then(resolve);
        }
        return () => proxy;
      },
    };
    const proxy: object = new Proxy({}, handler);
    return proxy;
  },
};

mock.module('@showbook/db', {
  namedExports: { ...realDb, db: fakeDb },
});

let playlistMod: typeof import('../spotify-playlist');
let spotifyMod: typeof import('../spotify');
let origFetch: typeof globalThis.fetch;

before(async () => {
  playlistMod = await import('../spotify-playlist');
  spotifyMod = await import('../spotify');
});

beforeEach(() => {
  origFetch = globalThis.fetch;
  DB_SCRIPT.songRows = [];
  playlistMod.__resetTrackResolveCacheForTests();
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

function trackSearchResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeTrack(id: string, name: string, artist = 'Phoebe Bridgers') {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: [{ name: artist }],
    duration_ms: 200_000,
  };
}

describe('buildPlaylistName', () => {
  it('formats the hype variant as "Hype: {artist} @ {venue} · {date}"', () => {
    const name = playlistMod.buildPlaylistName('hype', {
      artistName: 'Phoebe Bridgers',
      venueName: 'Madison Square Garden',
      date: '2026-08-15',
      confidence: 0.9,
    });
    assert.equal(
      name,
      'Hype: Phoebe Bridgers @ Madison Square Garden · 2026-08-15',
    );
  });

  it('formats the heard variant as "I Heard: {artist} ..."', () => {
    const name = playlistMod.buildPlaylistName('heard', {
      artistName: 'No Doubt',
      venueName: 'Coachella',
      date: '2026-04-20',
      confidence: null,
    });
    assert.equal(name, 'I Heard: No Doubt @ Coachella · 2026-04-20');
  });

  it('truncates to <=100 chars with ellipsis when the venue/artist is very long', () => {
    const name = playlistMod.buildPlaylistName('hype', {
      artistName: 'A'.repeat(120),
      venueName: 'B'.repeat(80),
      date: '2026-08-15',
      confidence: 0.9,
    });
    assert.ok(name.length <= 100);
    assert.ok(name.endsWith('…'));
  });
});

describe('buildPlaylistDescription', () => {
  it('hype description includes the confidence percent', () => {
    const desc = playlistMod.buildPlaylistDescription('hype', {
      artistName: 'Phoebe',
      venueName: 'MSG',
      date: '2026-08-15',
      confidence: 0.87,
    });
    assert.match(desc, /87%/);
    assert.match(desc, /Tracks may shuffle live/);
  });

  it('hype description handles null confidence without a NaN%', () => {
    const desc = playlistMod.buildPlaylistDescription('hype', {
      artistName: 'Phoebe',
      venueName: 'MSG',
      date: '2026-08-15',
      confidence: null,
    });
    assert.match(desc, /a setlist prediction/);
    assert.doesNotMatch(desc, /NaN/);
    assert.doesNotMatch(desc, /null/);
  });

  it('heard description references the venue + date', () => {
    const desc = playlistMod.buildPlaylistDescription('heard', {
      artistName: 'Phoebe',
      venueName: 'MSG',
      date: '2026-08-15',
      confidence: null,
    });
    assert.match(desc, /MSG/);
    assert.match(desc, /2026-08-15/);
  });
});

describe('diffScopes', () => {
  it('returns empty missing when every required scope is present', () => {
    const result = spotifyMod.diffScopes(
      'playlist-modify-private playlist-modify-public user-follow-read',
      spotifyMod.HYPE_PLAYLIST_SCOPES,
    );
    assert.deepEqual(result.missing, []);
    assert.ok(result.granted.includes('user-follow-read'));
  });

  it('flags missing scopes', () => {
    const result = spotifyMod.diffScopes(
      'user-follow-read playlist-modify-private',
      spotifyMod.HYPE_PLAYLIST_SCOPES,
    );
    assert.deepEqual(result.missing, ['playlist-modify-public']);
  });

  it('treats missing/null scope as everything missing', () => {
    const result = spotifyMod.diffScopes(null, spotifyMod.HYPE_PLAYLIST_SCOPES);
    assert.deepEqual(result.missing, [...spotifyMod.HYPE_PLAYLIST_SCOPES]);
  });
});

describe('resolveTrackUris', () => {
  it('keeps tracks in source order — openers first, encore last', async () => {
    const queries: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      queries.push(url);
      const u = new URL(url);
      const q = u.searchParams.get('q') ?? '';
      if (q.includes('track:Opener')) {
        return trackSearchResponse({
          tracks: { items: [makeTrack('open1', 'Opener')] },
        });
      }
      if (q.includes('track:Middle')) {
        return trackSearchResponse({
          tracks: { items: [makeTrack('mid1', 'Middle')] },
        });
      }
      if (q.includes('track:Encore')) {
        return trackSearchResponse({
          tracks: { items: [makeTrack('enc1', 'Encore')] },
        });
      }
      return trackSearchResponse({ tracks: { items: [] } });
    }) as typeof globalThis.fetch;

    const result = await playlistMod.resolveTrackUris('token', 'Phoebe Bridgers', [
      { title: 'Opener' },
      { title: 'Middle' },
      { title: 'Encore' },
    ]);
    assert.deepEqual(result.uris, [
      'spotify:track:open1',
      'spotify:track:mid1',
      'spotify:track:enc1',
    ]);
    assert.equal(result.resolved, 3);
    assert.equal(result.requested, 3);
    assert.deepEqual(result.missing, []);
  });

  it('caches per (artist+title) — second pass for the same songs makes zero new fetch calls', async () => {
    let calls = 0;
    globalThis.fetch = (async (input: string | URL) => {
      calls += 1;
      const url = typeof input === 'string' ? input : input.toString();
      const u = new URL(url);
      const q = u.searchParams.get('q') ?? '';
      if (q.includes('track:Hit')) {
        return trackSearchResponse({
          tracks: { items: [makeTrack('hit1', 'Hit')] },
        });
      }
      return trackSearchResponse({ tracks: { items: [] } });
    }) as typeof globalThis.fetch;

    await playlistMod.resolveTrackUris('token', 'Phoebe', [{ title: 'Hit' }]);
    await playlistMod.resolveTrackUris('token', 'Phoebe', [{ title: 'Hit' }]);
    assert.equal(calls, 1, 'second call should be served from cache');
  });

  it('case-folds the cache key so "Hit" and "hit" share an entry', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return trackSearchResponse({
        tracks: { items: [makeTrack('hit1', 'Hit')] },
      });
    }) as typeof globalThis.fetch;
    await playlistMod.resolveTrackUris('token', 'Phoebe', [{ title: 'Hit' }]);
    await playlistMod.resolveTrackUris('token', 'Phoebe', [{ title: 'hit' }]);
    await playlistMod.resolveTrackUris('token', 'phoebe', [{ title: 'HIT' }]);
    assert.equal(calls, 1);
  });

  it('records missing titles when Spotify returns no match', async () => {
    globalThis.fetch = (async () =>
      trackSearchResponse({ tracks: { items: [] } })) as typeof globalThis.fetch;

    const result = await playlistMod.resolveTrackUris('token', 'Phoebe', [
      { title: 'Unmatched' },
    ]);
    assert.deepEqual(result.uris, []);
    assert.deepEqual(result.missing, ['Unmatched']);
    assert.equal(result.resolved, 0);
    assert.equal(result.requested, 1);
  });

  it('caches negative results so we do not re-search the same miss', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return trackSearchResponse({ tracks: { items: [] } });
    }) as typeof globalThis.fetch;
    await playlistMod.resolveTrackUris('token', 'Phoebe', [{ title: 'Nope' }]);
    await playlistMod.resolveTrackUris('token', 'Phoebe', [{ title: 'Nope' }]);
    assert.equal(calls, 1);
  });

  it('short-circuits via songs.spotify_track_id when populated and non-sentinel', async () => {
    DB_SCRIPT.songRows = [
      {
        id: 'song-1',
        spotifyTrackId: 'preresolved',
        durationMs: 100_000,
      },
    ];
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return trackSearchResponse({ tracks: { items: [] } });
    }) as typeof globalThis.fetch;

    const result = await playlistMod.resolveTrackUris('token', 'Phoebe', [
      { title: 'Pre-resolved', songId: 'song-1' },
    ]);
    assert.deepEqual(result.uris, ['spotify:track:preresolved']);
    assert.equal(result.durationMs, 100_000);
    assert.equal(fetchCalls, 0, 'no fetch when songs row already has id');
  });

  it('does not short-circuit on the sentinel value __none__', async () => {
    DB_SCRIPT.songRows = [
      { id: 'song-2', spotifyTrackId: '__none__', durationMs: null },
    ];
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return trackSearchResponse({ tracks: { items: [makeTrack('s2', 'New')] } });
    }) as typeof globalThis.fetch;

    const result = await playlistMod.resolveTrackUris('token', 'Phoebe', [
      { title: 'New', songId: 'song-2' },
    ]);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(result.uris, ['spotify:track:s2']);
  });

  it('does not poison the cache on search errors — next call retries', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('boom', { status: 500 });
      }
      return trackSearchResponse({
        tracks: { items: [makeTrack('after', 'After')] },
      });
    }) as typeof globalThis.fetch;

    const first = await playlistMod.resolveTrackUris('token', 'Phoebe', [{ title: 'After' }]);
    assert.deepEqual(first.uris, []);
    assert.deepEqual(first.missing, ['After']);

    const second = await playlistMod.resolveTrackUris('token', 'Phoebe', [
      { title: 'After' },
    ]);
    assert.deepEqual(second.uris, ['spotify:track:after']);
    assert.equal(calls, 2);
  });
});
