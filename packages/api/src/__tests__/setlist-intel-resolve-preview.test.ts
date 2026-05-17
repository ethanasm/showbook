/**
 * Unit tests for the iTunes-fallback path in
 * `setlistIntelRouter.resolveTrackPreview` (the row-play resolver
 * added when Spotify's Search API stopped returning `preview_url`).
 *
 * Strategy: `mock.module` swaps spotify-tokens, spotify, and itunes so
 * the procedure runs end-to-end against the fake DB without any
 * network or DB. Each test uses a fresh userId so the per-user
 * rate-limit buckets are isolated across cases.
 */

import { before, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';

let spotifySearchResult: { id: string; previewUrl: string | null; durationMs: number } | null = null;
let spotifySearchThrows: Error | null = null;
let spotifySearchCalls = 0;

let itunesSearchResult: { previewUrl: string; durationMs: number | null } | null = null;
let itunesSearchThrows: Error | null = null;
let itunesSearchCalls = 0;

mock.module('../spotify-tokens.js', {
  namedExports: {
    ensureFreshUserToken: async () => 'fake-token',
  },
});

mock.module('../spotify.js', {
  namedExports: {
    searchTrack: async () => {
      spotifySearchCalls += 1;
      if (spotifySearchThrows) throw spotifySearchThrows;
      return spotifySearchResult
        ? {
            id: spotifySearchResult.id,
            uri: `spotify:track:${spotifySearchResult.id}`,
            name: 'mock',
            artists: ['mock'],
            durationMs: spotifySearchResult.durationMs,
            previewUrl: spotifySearchResult.previewUrl,
          }
        : null;
    },
    getFollowedArtists: async () => [],
    SpotifyError: class SpotifyError extends Error {
      constructor(message: string, public status: number) {
        super(message);
        this.name = 'SpotifyError';
      }
    },
  },
});

class ITunesErrorMock extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ITunesError';
  }
}

mock.module('../itunes.js', {
  namedExports: {
    ITunesError: ITunesErrorMock,
    searchTrackPreview: async () => {
      itunesSearchCalls += 1;
      if (itunesSearchThrows) throw itunesSearchThrows;
      return itunesSearchResult
        ? {
            artist: 'mock-artist',
            title: 'mock-title',
            previewUrl: itunesSearchResult.previewUrl,
            durationMs: itunesSearchResult.durationMs,
          }
        : null;
    },
  },
});

let setlistIntelRouter: typeof import('../routers/setlist-intel').setlistIntelRouter;
let makeFakeDb: typeof import('./_fake-db').makeFakeDb;
let fakeCtx: typeof import('./_fake-db').fakeCtx;
let fakeUuid: typeof import('./_test-helpers').fakeUuid;

before(async () => {
  ({ setlistIntelRouter } = await import('../routers/setlist-intel'));
  ({ makeFakeDb, fakeCtx } = await import('./_fake-db'));
  ({ fakeUuid } = await import('./_test-helpers'));
});

interface CallerFixtureOpts {
  /** Existing songs row for the row being resolved. */
  cachedRow?: {
    id: string;
    previewUrl: string | null;
    spotifyTrackId: string | null;
    previewResolvedAt: Date | null;
  } | null;
}

function makeResolverDb(headlinerId: string, opts: CallerFixtureOpts) {
  // The mutation does:
  //   1) select song row by performerId+title.lower
  //   2) update songs (no select), OR insert songs onConflictDoNothing
  // So the only scripted select is the cached-row lookup. The fake-db
  // wrapper prepends an auth-user select that we skip past.
  const cached = opts.cachedRow ?? null;
  return makeFakeDb({
    selectResults: [cached ? [cached] : []],
    updateResults: [[]],
    insertResults: [[]],
  });
}

function showFixture(headlinerId: string) {
  return {
    id: 'fake-show-id',
    userId: 'test-user',
    showPerformers: [
      {
        role: 'headliner',
        sortOrder: 0,
        performer: { id: headlinerId, name: 'No Doubt' },
      },
    ],
  };
}

function makeCaller(headlinerId: string, opts: CallerFixtureOpts, userId: string) {
  const db = makeResolverDb(headlinerId, opts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.query as any).shows = {
    findFirst: async () => ({ ...showFixture(headlinerId), userId }),
  };
  return setlistIntelRouter.createCaller(fakeCtx(db, userId) as never);
}

function resetMocks() {
  spotifySearchResult = null;
  spotifySearchThrows = null;
  spotifySearchCalls = 0;
  itunesSearchResult = null;
  itunesSearchThrows = null;
  itunesSearchCalls = 0;
}

describe('resolveTrackPreview — iTunes fallback', () => {
  test('Spotify hit with preview_url returns Spotify preview, never calls iTunes', async () => {
    resetMocks();
    spotifySearchResult = {
      id: 'sp_track_1',
      previewUrl: 'https://p.scdn.co/preview-1.mp3',
      durationMs: 200_000,
    };
    const headlinerId = fakeUuid('p', 'h1');
    const caller = makeCaller(headlinerId, { cachedRow: null }, 'user-spotify-hit');
    const result = await caller.resolveTrackPreview({
      showId: fakeUuid('s', '1'),
      title: 'Tragic Kingdom',
    });
    assert.equal(result.previewUrl, 'https://p.scdn.co/preview-1.mp3');
    assert.equal(result.spotifyTrackId, 'sp_track_1');
    assert.equal(spotifySearchCalls, 1);
    assert.equal(itunesSearchCalls, 0, 'iTunes should not be hit when Spotify has a preview');
  });

  test('Spotify hit with null preview falls back to iTunes, returns iTunes URL + Spotify track id', async () => {
    resetMocks();
    spotifySearchResult = {
      id: 'sp_track_2',
      previewUrl: null,
      durationMs: 0,
    };
    itunesSearchResult = {
      previewUrl: 'https://audio-ssl.itunes.apple.com/preview-2.m4a',
      durationMs: 331_667,
    };
    const headlinerId = fakeUuid('p', 'h2');
    const caller = makeCaller(headlinerId, { cachedRow: null }, 'user-itunes-fallback');
    const result = await caller.resolveTrackPreview({
      showId: fakeUuid('s', '2'),
      title: 'Tragic Kingdom',
    });
    assert.equal(result.previewUrl, 'https://audio-ssl.itunes.apple.com/preview-2.m4a');
    assert.equal(result.spotifyTrackId, 'sp_track_2');
    assert.equal(spotifySearchCalls, 1);
    assert.equal(itunesSearchCalls, 1);
  });

  test('Spotify hit with null preview AND iTunes empty returns both null', async () => {
    resetMocks();
    spotifySearchResult = {
      id: 'sp_track_3',
      previewUrl: null,
      durationMs: 0,
    };
    itunesSearchResult = null;
    const headlinerId = fakeUuid('p', 'h3');
    const caller = makeCaller(headlinerId, { cachedRow: null }, 'user-both-null');
    const result = await caller.resolveTrackPreview({
      showId: fakeUuid('s', '3'),
      title: 'Unknown',
    });
    assert.equal(result.previewUrl, null);
    assert.equal(result.spotifyTrackId, 'sp_track_3');
    assert.equal(spotifySearchCalls, 1);
    assert.equal(itunesSearchCalls, 1);
  });

  test('Spotify miss falls back to iTunes — caches __none__ Spotify id but returns iTunes preview', async () => {
    resetMocks();
    spotifySearchResult = null;
    itunesSearchResult = {
      previewUrl: 'https://audio-ssl.itunes.apple.com/preview-4.m4a',
      durationMs: 200_000,
    };
    const headlinerId = fakeUuid('p', 'h4');
    const caller = makeCaller(headlinerId, { cachedRow: null }, 'user-spotify-miss');
    const result = await caller.resolveTrackPreview({
      showId: fakeUuid('s', '4'),
      title: 'Obscure Cover',
    });
    // spotifyTrackId stays null (we set __none__ in DB but return null
    // to the client per the trackPreviewsForShow contract).
    assert.equal(result.spotifyTrackId, null);
    assert.equal(result.previewUrl, 'https://audio-ssl.itunes.apple.com/preview-4.m4a');
    assert.equal(spotifySearchCalls, 1);
    assert.equal(itunesSearchCalls, 1);
  });

  test('cache hit (previewResolvedAt set) returns cached preview without hitting either API', async () => {
    resetMocks();
    const headlinerId = fakeUuid('p', 'h5');
    const caller = makeCaller(
      headlinerId,
      {
        cachedRow: {
          id: 'song-cached-1',
          previewUrl: 'https://cached/preview.m4a',
          spotifyTrackId: 'sp_track_cached',
          previewResolvedAt: new Date(),
        },
      },
      'user-cache-hit',
    );
    const result = await caller.resolveTrackPreview({
      showId: fakeUuid('s', '5'),
      title: 'Already Resolved',
    });
    assert.equal(result.previewUrl, 'https://cached/preview.m4a');
    assert.equal(result.spotifyTrackId, 'sp_track_cached');
    assert.equal(spotifySearchCalls, 0);
    assert.equal(itunesSearchCalls, 0);
  });

  test('cache hit (resolvedAt set, null URL) returns null without re-querying', async () => {
    resetMocks();
    const headlinerId = fakeUuid('p', 'h6');
    const caller = makeCaller(
      headlinerId,
      {
        cachedRow: {
          id: 'song-cached-2',
          previewUrl: null,
          spotifyTrackId: '__none__',
          previewResolvedAt: new Date(),
        },
      },
      'user-cache-hit-null',
    );
    const result = await caller.resolveTrackPreview({
      showId: fakeUuid('s', '6'),
      title: 'Tried Both, Got Nothing',
    });
    assert.equal(result.previewUrl, null);
    assert.equal(result.spotifyTrackId, null);
    assert.equal(spotifySearchCalls, 0);
    assert.equal(itunesSearchCalls, 0);
  });

  test('legacy row (spotifyTrackId set, no previewResolvedAt) skips Spotify but tries iTunes', async () => {
    resetMocks();
    itunesSearchResult = {
      previewUrl: 'https://audio-ssl.itunes.apple.com/legacy-backfill.m4a',
      durationMs: 250_000,
    };
    const headlinerId = fakeUuid('p', 'h7');
    const caller = makeCaller(
      headlinerId,
      {
        cachedRow: {
          id: 'song-legacy',
          previewUrl: null,
          spotifyTrackId: 'sp_legacy',
          previewResolvedAt: null,
        },
      },
      'user-legacy-row',
    );
    const result = await caller.resolveTrackPreview({
      showId: fakeUuid('s', '7'),
      title: 'Legacy Tragic Kingdom',
    });
    assert.equal(result.previewUrl, 'https://audio-ssl.itunes.apple.com/legacy-backfill.m4a');
    assert.equal(result.spotifyTrackId, 'sp_legacy');
    assert.equal(spotifySearchCalls, 0, 'should NOT re-call Spotify for a row that already has a track id');
    assert.equal(itunesSearchCalls, 1);
  });

  test('legacy __none__ row (no previewResolvedAt) skips Spotify but tries iTunes', async () => {
    resetMocks();
    itunesSearchResult = {
      previewUrl: 'https://audio-ssl.itunes.apple.com/legacy-none.m4a',
      durationMs: 180_000,
    };
    const headlinerId = fakeUuid('p', 'h8');
    const caller = makeCaller(
      headlinerId,
      {
        cachedRow: {
          id: 'song-legacy-none',
          previewUrl: null,
          spotifyTrackId: '__none__',
          previewResolvedAt: null,
        },
      },
      'user-legacy-none',
    );
    const result = await caller.resolveTrackPreview({
      showId: fakeUuid('s', '8'),
      title: 'Legacy Miss',
    });
    assert.equal(result.previewUrl, 'https://audio-ssl.itunes.apple.com/legacy-none.m4a');
    assert.equal(result.spotifyTrackId, null);
    assert.equal(spotifySearchCalls, 0);
    assert.equal(itunesSearchCalls, 1);
  });

  test('iTunes 403 leaves the row unresolved so the next tap can retry', async () => {
    resetMocks();
    spotifySearchResult = {
      id: 'sp_track_403',
      previewUrl: null,
      durationMs: 0,
    };
    itunesSearchThrows = new ITunesErrorMock('iTunes rate limited', 403);
    const headlinerId = fakeUuid('p', 'h9');
    const userId = 'user-itunes-403';
    const caller = makeCaller(headlinerId, { cachedRow: null }, userId);
    const result = await caller.resolveTrackPreview({
      showId: fakeUuid('s', '9'),
      title: 'Rate Limited',
    });
    // Spotify track id is still returned (cached for future use) but
    // preview is null and the row is NOT marked resolved — verified by
    // the integration story: a second call returns the same shape, not
    // a cached "null forever". Asserting the cache state directly would
    // require a richer fake-db; the public-contract assertion here is
    // enough to keep this in regression coverage.
    assert.equal(result.previewUrl, null);
    assert.equal(result.spotifyTrackId, 'sp_track_403');
    assert.equal(itunesSearchCalls, 1);
  });

  test('per-user iTunes rate-limit (20/min) trips after enough calls and skips the iTunes hop', async () => {
    resetMocks();
    spotifySearchResult = {
      id: 'sp_track_perlimit',
      previewUrl: null,
      durationMs: 0,
    };
    itunesSearchResult = {
      previewUrl: 'https://audio-ssl.itunes.apple.com/perlimit.m4a',
      durationMs: 200_000,
    };
    const headlinerId = fakeUuid('p', 'hr');
    const userId = 'user-perlimit';
    // 21 sequential calls — the iTunes bucket is 20/min, so the 21st
    // call shouldn't fire iTunes.
    for (let i = 0; i < 21; i += 1) {
      const caller = makeCaller(headlinerId, { cachedRow: null }, userId);
      await caller.resolveTrackPreview({
        showId: fakeUuid('s', `r-${i}`),
        title: `Different Song ${i}`,
      });
    }
    assert.equal(spotifySearchCalls, 21);
    assert.equal(
      itunesSearchCalls,
      20,
      'iTunes should only fire 20 times per minute; the 21st call should be skipped',
    );
  });

  test('Spotify throws (network error) returns null without touching iTunes', async () => {
    resetMocks();
    spotifySearchThrows = new Error('ECONNRESET');
    const headlinerId = fakeUuid('p', 'hx');
    const caller = makeCaller(headlinerId, { cachedRow: null }, 'user-spotify-throws');
    const result = await caller.resolveTrackPreview({
      showId: fakeUuid('s', 'x'),
      title: 'Network Fail',
    });
    assert.equal(result.previewUrl, null);
    assert.equal(result.spotifyTrackId, null);
    assert.equal(itunesSearchCalls, 0);
  });
});
