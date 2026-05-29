/**
 * Unit tests for runAlbumMetadataFill. Spotify is mocked at the
 * `@showbook/api` boundary (getAppAccessToken / withAppToken /
 * getArtistAlbums / getAlbumTracks / SpotifyError) and the DB is
 * replaced with a minimal drizzle-shaped fake — same pattern as
 * backfill-performer-mbids.test.ts.
 *
 * The regression of record: a run-wide 401 (revoked/restricted
 * client-credentials) used to log one `performer_failed` error per
 * performer (1145 in a single May-2026 run), tripping the error_volume
 * health check and grinding the job past its 30-min pg-boss expiry into
 * a `failed` state. The job now bails on the first 401 and logs once.
 */

import { describe, it, beforeEach, before, mock } from 'node:test';
import assert from 'node:assert/strict';

class FakeSpotifyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SpotifyError';
    this.status = status;
  }
}

interface PerformerRow {
  id: string;
  spotifyArtistId: string | null;
  name: string;
}

interface AlbumStub {
  id: string;
  name: string;
  releaseDate: string;
  albumType: string;
}

interface Script {
  performers: PerformerRow[];
  albumsByArtist: Map<string, AlbumStub[]>;
  errorByArtist: Map<string, Error>;
  tracksByAlbum: Map<string, string[]>;
  appTokenError: Error | null;
  inserts: string[];
}

const SCRIPT: Script = {
  performers: [],
  albumsByArtist: new Map(),
  errorByArtist: new Map(),
  tracksByAlbum: new Map(),
  appTokenError: null,
  inserts: [],
};

const events: Array<{ level: string; event: string | undefined }> = [];

function reset() {
  SCRIPT.performers = [];
  SCRIPT.albumsByArtist = new Map();
  SCRIPT.errorByArtist = new Map();
  SCRIPT.tracksByAlbum = new Map();
  SCRIPT.appTokenError = null;
  SCRIPT.inserts = [];
  events.length = 0;
}

function countEvent(name: string): number {
  return events.filter((e) => e.event === name).length;
}

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(SCRIPT.performers),
    }),
  }),
  insert: () => ({
    values: (vals: { spotifyAlbumId: string }) => ({
      onConflictDoUpdate: () => {
        SCRIPT.inserts.push(vals.spotifyAlbumId);
        return Promise.resolve(undefined);
      },
    }),
  }),
};

mock.module('@showbook/db', {
  namedExports: {
    db: fakeDb,
    albums: { spotifyAlbumId: 'albums.spotify_album_id' },
    performers: {
      id: 'performers.id',
      name: 'performers.name',
      spotifyArtistId: 'performers.spotify_artist_id',
    },
  },
});

mock.module('@showbook/api', {
  namedExports: {
    SpotifyError: FakeSpotifyError,
    getAppAccessToken: async () => {
      if (SCRIPT.appTokenError) throw SCRIPT.appTokenError;
      return 'app-token';
    },
    // The real withAppToken retries once on a 401; here we run the fn
    // directly and let its error propagate — the retry semantics are
    // exercised at the @showbook/api layer, not in the job.
    withAppToken: async (fn: (token: string) => Promise<unknown>) =>
      fn('app-token'),
    getArtistAlbums: async (artistId: string) => {
      const err = SCRIPT.errorByArtist.get(artistId);
      if (err) throw err;
      return SCRIPT.albumsByArtist.get(artistId) ?? [];
    },
    getAlbumTracks: async (albumId: string) => ({
      trackIds: SCRIPT.tracksByAlbum.get(albumId) ?? [],
    }),
  },
});

mock.module('@showbook/observability', {
  namedExports: {
    child: () => ({
      info: (payload: { event?: string }) =>
        events.push({ level: 'info', event: payload?.event }),
      warn: (payload: { event?: string }) =>
        events.push({ level: 'warn', event: payload?.event }),
      error: (payload: { event?: string }) =>
        events.push({ level: 'error', event: payload?.event }),
      child() {
        return this;
      },
    }),
    flushObservability: async () => {},
  },
});

let mod: typeof import('../album-metadata-fill');

before(async () => {
  mod = await import('../album-metadata-fill');
});

describe('runAlbumMetadataFill', () => {
  beforeEach(reset);

  it('aborts the run on a wide 401 and logs auth_rejected once', async () => {
    SCRIPT.performers = [
      { id: 'p1', spotifyArtistId: 'a1', name: 'One' },
      { id: 'p2', spotifyArtistId: 'a2', name: 'Two' },
      { id: 'p3', spotifyArtistId: 'a3', name: 'Three' },
    ];
    for (const a of ['a1', 'a2', 'a3']) {
      SCRIPT.errorByArtist.set(a, new FakeSpotifyError('getArtistAlbums 401', 401));
    }

    const res = await mod.runAlbumMetadataFill();

    // Bailed after the first performer rather than grinding all three.
    assert.equal(res.attempted, 1);
    assert.equal(res.failed, 1);
    assert.equal(res.performersUpdated, 0);
    assert.equal(countEvent('album_metadata_fill.auth_rejected'), 1);
    assert.equal(countEvent('album_metadata_fill.performer_failed'), 0);
  });

  it('logs per-performer failure and continues on a non-401 error', async () => {
    SCRIPT.performers = [
      { id: 'p1', spotifyArtistId: 'a1', name: 'One' },
      { id: 'p2', spotifyArtistId: 'a2', name: 'Two' },
    ];
    SCRIPT.errorByArtist.set('a1', new FakeSpotifyError('getArtistAlbums 500', 500));
    SCRIPT.albumsByArtist.set('a2', [
      { id: 'al2', name: 'Album', releaseDate: '2026-01-01', albumType: 'album' },
    ]);
    SCRIPT.tracksByAlbum.set('al2', ['t1', 't2']);

    const res = await mod.runAlbumMetadataFill();

    assert.equal(res.attempted, 2);
    assert.equal(res.failed, 1);
    assert.equal(res.performersUpdated, 1);
    assert.equal(res.albumsUpserted, 1);
    assert.equal(countEvent('album_metadata_fill.performer_failed'), 1);
    assert.equal(countEvent('album_metadata_fill.auth_rejected'), 0);
    assert.deepEqual(SCRIPT.inserts, ['al2']);
  });

  it('skips the run cleanly when the app-level token fetch fails', async () => {
    SCRIPT.performers = [{ id: 'p1', spotifyArtistId: 'a1', name: 'One' }];
    SCRIPT.appTokenError = new Error('token exchange 400');

    const res = await mod.runAlbumMetadataFill();

    assert.equal(res.attempted, 0);
    assert.equal(res.failed, 0);
    assert.equal(countEvent('album_metadata_fill.token_failed'), 1);
  });
});
