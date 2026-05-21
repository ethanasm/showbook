/**
 * Integration test: full createHypePlaylist / createHeardPlaylist round
 * trip against the real Postgres `showbook_e2e` DB. No real Spotify
 * HTTP — `globalThis.fetch` is stubbed to mimic:
 *   - `accounts.spotify.com/api/token` (token refresh on near-expiry)
 *   - `api.spotify.com/v1/me` (profile lookup at connect)
 *   - `api.spotify.com/v1/search?type=track` (per-song resolution)
 *   - `api.spotify.com/v1/me/playlists` (POST playlist, post-Feb-2026
 *     migration — replaces the deprecated `/users/{id}/playlists`)
 *   - `api.spotify.com/v1/playlists/{id}/items` (POST batch add,
 *     post-Feb-2026 — replaces the deprecated `/tracks`)
 *
 * The point is the DB write — the show_spotify_playlists idempotency
 * row, the (showId, userId, kind) uniqueness, and the cascade behavior
 * on disconnect.
 */

import { describe, it, before, beforeEach, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import {
  db,
  performers,
  shows,
  showPerformers,
  showSpotifyPlaylists,
  tourSetlists,
  userSpotifyTokens,
  users,
  venues,
} from '@showbook/db';
import { __resetKeyCacheForTests } from '../crypto';
import {
  createHeardPlaylist,
  createHypePlaylist,
  getExistingPlaylist,
  __resetTrackResolveCacheForTests,
} from '../spotify-playlist';
import { persistInitialToken } from '../spotify-tokens';
import { disconnectSpotify } from '../spotify-tokens';
import {
  cleanupByPrefix,
  fakeUuid,
  withTimeout,
} from './_test-helpers';
import { SPOTIFY_SCOPE_STRING } from '../spotify';

const PREFIX = 'splp-';
const USER_ID = `${PREFIX}user-1`;
const VENUE_ID = fakeUuid(PREFIX, 'venue-1');
const PERFORMER_ID = fakeUuid(PREFIX, 'perf-1');
const SUPPORT_PERFORMER_ID = fakeUuid(PREFIX, 'perf-2');
const HYPE_SHOW_ID = fakeUuid(PREFIX, 'show-hype');
const HEARD_SHOW_ID = fakeUuid(PREFIX, 'show-heard');
const FESTIVAL_SHOW_ID = fakeUuid(PREFIX, 'show-festival');
const TOUR_SETLIST_ID = fakeUuid(PREFIX, 'tour-set-1');

const FAKE_SONGS = ['Opener Song', 'Mid Banger', 'Closer Ballad', 'Encore Anthem'];
const SUPPORT_SONGS = ['Support Opener', 'Support Hit', 'Support Closer'];

interface FetchLog {
  searchQ: string[];
  playlistCreates: Array<{ name: string; description: string; public: boolean }>;
  tracksAdds: Array<{ playlistId: string; uris: string[]; position?: number }>;
}

const FETCH_LOG: FetchLog = {
  searchQ: [],
  playlistCreates: [],
  tracksAdds: [],
};

let origFetch: typeof globalThis.fetch;
let origKey: string | undefined;
let origClientId: string | undefined;
let origClientSecret: string | undefined;

before(async () => {
  await withTimeout(45_000, async () => {
    await db
      .insert(users)
      .values({ id: USER_ID, email: `${USER_ID}@test.local` })
      .onConflictDoNothing();
    await db
      .insert(venues)
      .values({
        id: VENUE_ID,
        name: 'Test Arena',
        city: 'New York',
        country: 'US',
      })
      .onConflictDoNothing();
    await db
      .insert(performers)
      .values([
        {
          id: PERFORMER_ID,
          name: 'Phoebe Bridgers',
          musicbrainzId: 'phoebe-mbid',
        },
        {
          id: SUPPORT_PERFORMER_ID,
          name: 'Soccer Mommy',
          musicbrainzId: 'soccer-mommy-mbid',
        },
      ])
      .onConflictDoNothing();
    // Three shows — pre-show concert (hype), past concert (heard), and
    // a past festival with two performers' setlists so the
    // per-performer split has a real `setlists` map to draw from.
    await db
      .insert(shows)
      .values([
        {
          id: HYPE_SHOW_ID,
          userId: USER_ID,
          venueId: VENUE_ID,
          kind: 'concert',
          state: 'ticketed',
          date: '2026-09-12',
        },
        {
          id: HEARD_SHOW_ID,
          userId: USER_ID,
          venueId: VENUE_ID,
          kind: 'concert',
          state: 'past',
          date: '2024-12-05',
          setlists: {
            [PERFORMER_ID]: {
              sections: [
                { kind: 'set', songs: FAKE_SONGS.slice(0, 3).map((title) => ({ title })) },
                { kind: 'encore', songs: [{ title: FAKE_SONGS[3]! }] },
              ],
            },
          },
        },
        {
          id: FESTIVAL_SHOW_ID,
          userId: USER_ID,
          venueId: VENUE_ID,
          kind: 'festival',
          state: 'past',
          date: '2024-08-15',
          setlists: {
            [PERFORMER_ID]: {
              sections: [
                { kind: 'set', songs: FAKE_SONGS.map((title) => ({ title })) },
              ],
            },
            [SUPPORT_PERFORMER_ID]: {
              sections: [
                { kind: 'set', songs: SUPPORT_SONGS.map((title) => ({ title })) },
              ],
            },
          },
        },
      ])
      .onConflictDoNothing();
    await db
      .insert(showPerformers)
      .values([
        {
          showId: HYPE_SHOW_ID,
          performerId: PERFORMER_ID,
          role: 'headliner',
          sortOrder: 0,
        },
        {
          showId: HEARD_SHOW_ID,
          performerId: PERFORMER_ID,
          role: 'headliner',
          sortOrder: 0,
        },
        {
          showId: FESTIVAL_SHOW_ID,
          performerId: PERFORMER_ID,
          role: 'headliner',
          sortOrder: 0,
        },
        {
          showId: FESTIVAL_SHOW_ID,
          performerId: SUPPORT_PERFORMER_ID,
          role: 'support',
          sortOrder: 1,
        },
      ])
      .onConflictDoNothing();
    // Seed a tour_setlists row so the predicted-setlist path has
    // corpus rows to operate on for the hype variant.
    await db
      .insert(tourSetlists)
      .values({
        id: TOUR_SETLIST_ID,
        performerId: PERFORMER_ID,
        performanceDate: '2026-09-01',
        setlistfmId: `${PREFIX}sl-1`,
        setlist: { sections: [{ kind: 'set', songs: FAKE_SONGS.map((t) => ({ title: t })) }] },
        songCount: FAKE_SONGS.length,
      })
      .onConflictDoNothing();
  });
});

beforeEach(() => {
  origFetch = globalThis.fetch;
  origKey = process.env.TOKEN_KEY;
  origClientId = process.env.SPOTIFY_CLIENT_ID;
  origClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  process.env.TOKEN_KEY = 'a'.repeat(64);
  process.env.SPOTIFY_CLIENT_ID = 'test-client';
  process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
  __resetKeyCacheForTests();
  __resetTrackResolveCacheForTests();
  FETCH_LOG.searchQ = [];
  FETCH_LOG.playlistCreates = [];
  FETCH_LOG.tracksAdds = [];
});

afterEach(async () => {
  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.TOKEN_KEY;
  else process.env.TOKEN_KEY = origKey;
  if (origClientId === undefined) delete process.env.SPOTIFY_CLIENT_ID;
  else process.env.SPOTIFY_CLIENT_ID = origClientId;
  if (origClientSecret === undefined) delete process.env.SPOTIFY_CLIENT_SECRET;
  else process.env.SPOTIFY_CLIENT_SECRET = origClientSecret;
  await db
    .delete(showSpotifyPlaylists)
    .where(eq(showSpotifyPlaylists.userId, USER_ID));
  await db
    .delete(userSpotifyTokens)
    .where(eq(userSpotifyTokens.userId, USER_ID));
});

after(async () => {
  await withTimeout(45_000, async () => {
    await db
      .delete(showSpotifyPlaylists)
      .where(eq(showSpotifyPlaylists.userId, USER_ID));
    await db
      .delete(userSpotifyTokens)
      .where(eq(userSpotifyTokens.userId, USER_ID));
    await db
      .delete(tourSetlists)
      .where(eq(tourSetlists.performerId, PERFORMER_ID));
    // Shows cascade-deletes the show_performers rows that pin both
    // headliner + support performers, so they're safe to drop next.
    await db.delete(shows).where(eq(shows.userId, USER_ID));
    await db.delete(performers).where(eq(performers.id, PERFORMER_ID));
    await db.delete(performers).where(eq(performers.id, SUPPORT_PERFORMER_ID));
    await db.delete(venues).where(eq(venues.id, VENUE_ID));
    await cleanupByPrefix(PREFIX);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockSpotify(opts: {
  scopeForToken?: string;
  searchResults?: Record<string, string | null>;
  playlistCreateStatus?: number;
  addTracksStatus?: number;
} = {}) {
  const scope = opts.scopeForToken ?? SPOTIFY_SCOPE_STRING;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    if (u.host === 'accounts.spotify.com' && u.pathname === '/api/token') {
      // refresh — return fresh token
      return jsonResponse({
        access_token: 'access-refreshed',
        refresh_token: 'refresh-refreshed',
        expires_in: 3600,
        scope,
        token_type: 'Bearer',
      });
    }
    if (u.host === 'api.spotify.com' && u.pathname === '/v1/search') {
      const q = u.searchParams.get('q') ?? '';
      FETCH_LOG.searchQ.push(q);
      // Pull the track title out of `artist:X track:Y` (URL-decoded).
      const m = q.match(/track:(.+)$/);
      const title = (m?.[1] ?? '').trim();
      const trackId = opts.searchResults?.[title];
      if (trackId === undefined) {
        // Default — fabricate a Spotify track id from the title.
        const id = title.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
        return jsonResponse({
          tracks: {
            items: [
              {
                id,
                uri: `spotify:track:${id}`,
                name: title,
                artists: [{ name: 'Phoebe Bridgers' }],
                duration_ms: 240_000,
              },
            ],
          },
        });
      }
      if (trackId === null) {
        return jsonResponse({ tracks: { items: [] } });
      }
      return jsonResponse({
        tracks: {
          items: [
            {
              id: trackId,
              uri: `spotify:track:${trackId}`,
              name: title,
              artists: [{ name: 'Phoebe Bridgers' }],
              duration_ms: 200_000,
            },
          ],
        },
      });
    }
    if (
      u.host === 'api.spotify.com' &&
      u.pathname === '/v1/me/playlists' &&
      (init?.method ?? 'GET') === 'POST'
    ) {
      if (opts.playlistCreateStatus && opts.playlistCreateStatus !== 200) {
        return new Response('err', { status: opts.playlistCreateStatus });
      }
      const body = init?.body ? JSON.parse(init.body as string) : {};
      FETCH_LOG.playlistCreates.push({
        name: body.name,
        description: body.description,
        public: body.public ?? false,
      });
      const playlistId = `pl-${FETCH_LOG.playlistCreates.length}`;
      return jsonResponse({
        id: playlistId,
        name: body.name,
        external_urls: { spotify: `https://open.spotify.com/playlist/${playlistId}` },
      });
    }
    if (
      u.host === 'api.spotify.com' &&
      u.pathname.includes('/playlists/') &&
      u.pathname.endsWith('/items') &&
      (init?.method ?? 'GET') === 'POST'
    ) {
      if (opts.addTracksStatus && opts.addTracksStatus !== 200) {
        return new Response('err', { status: opts.addTracksStatus });
      }
      const body = init?.body ? JSON.parse(init.body as string) : {};
      const playlistMatch = u.pathname.match(/playlists\/([^/]+)\/items/);
      FETCH_LOG.tracksAdds.push({
        playlistId: playlistMatch?.[1] ?? '',
        uris: body.uris,
        position: body.position,
      });
      return jsonResponse({ snapshot_id: 'snap' });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof globalThis.fetch;
}

async function persistFreshToken(scope = SPOTIFY_SCOPE_STRING) {
  await persistInitialToken({
    userId: USER_ID,
    tokens: {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresIn: 3600,
      scope,
      tokenType: 'Bearer',
    },
    profile: { id: 'sp-user-test', displayName: 'Test', product: 'premium' },
  });
}

async function deletePlaylistRows() {
  await db.delete(showSpotifyPlaylists).where(eq(showSpotifyPlaylists.userId, USER_ID));
}

describe('createHeardPlaylist — end-to-end with mocked Spotify', () => {
  it('creates a private playlist, adds tracks in setlist order, and persists the idempotency row', async () => {
    mockSpotify();
    await persistFreshToken();

    const result = await createHeardPlaylist({
      userId: USER_ID,
      showId: HEARD_SHOW_ID,
    });

    assert.equal(result.reused, false);
    assert.equal(result.trackCount, 4);
    assert.equal(result.requested, 4);
    assert.deepEqual(result.missing, []);
    assert.equal(FETCH_LOG.playlistCreates.length, 1);
    const create = FETCH_LOG.playlistCreates[0]!;
    assert.equal(create.public, false);
    assert.match(create.name, /^I Heard: Phoebe Bridgers @ Test Arena · 2024-12-05$/);

    // The tracks were added in setlist order (main first, encore last).
    assert.equal(FETCH_LOG.tracksAdds.length, 1);
    const uris = FETCH_LOG.tracksAdds[0]!.uris;
    assert.equal(uris.length, 4);
    assert.equal(uris[3], 'spotify:track:encore-anthem');
    assert.equal(uris[0], 'spotify:track:opener-song');

    const [row] = await db
      .select()
      .from(showSpotifyPlaylists)
      .where(
        and(
          eq(showSpotifyPlaylists.userId, USER_ID),
          eq(showSpotifyPlaylists.showId, HEARD_SHOW_ID),
        ),
      );
    assert.ok(row);
    assert.equal(row!.kind, 'heard');
    assert.equal(row!.trackCount, 4);
  });

  it('is idempotent — re-tapping returns the existing row without re-creating', async () => {
    mockSpotify();
    await persistFreshToken();

    const first = await createHeardPlaylist({
      userId: USER_ID,
      showId: HEARD_SHOW_ID,
    });
    const second = await createHeardPlaylist({
      userId: USER_ID,
      showId: HEARD_SHOW_ID,
    });
    assert.equal(second.reused, true);
    assert.equal(second.playlistId, first.playlistId);
    assert.equal(second.spotifyUrl, first.spotifyUrl);
    // Only one create + one tracks-add hit Spotify across two attempts.
    assert.equal(FETCH_LOG.playlistCreates.length, 1);
    assert.equal(FETCH_LOG.tracksAdds.length, 1);
  });

  it('records missing titles when Spotify returns no match for one song', async () => {
    mockSpotify({
      searchResults: { 'Closer Ballad': null },
    });
    await persistFreshToken();

    const result = await createHeardPlaylist({
      userId: USER_ID,
      showId: HEARD_SHOW_ID,
    });
    assert.equal(result.trackCount, 3);
    assert.equal(result.requested, 4);
    assert.deepEqual(result.missing, ['Closer Ballad']);
  });

  it('refuses to create when stored scope is missing playlist-modify-private', async () => {
    mockSpotify();
    await persistFreshToken('user-follow-read'); // missing both playlist-modify-* scopes

    await assert.rejects(
      createHeardPlaylist({ userId: USER_ID, showId: HEARD_SHOW_ID }),
      (err: Error) => {
        assert.match(err.message, /spotify_scopes_missing/);
        return true;
      },
    );
    assert.equal(FETCH_LOG.playlistCreates.length, 0);
  });

  it('throws PRECONDITION_FAILED when the user is not connected', async () => {
    mockSpotify();
    await assert.rejects(
      createHeardPlaylist({ userId: USER_ID, showId: HEARD_SHOW_ID }),
      (err: Error) => {
        assert.match(err.message, /spotify_not_connected/);
        return true;
      },
    );
  });

  it('batches add-tracks calls in 100-URI chunks (multi-batch path)', async () => {
    mockSpotify();
    await persistFreshToken();

    // Build a 150-song setlist on a new ad-hoc show id so this test can
    // run independently. We bypass the orchestrator's setlist load by
    // updating the heard show in place.
    const longSetlist = Array.from({ length: 150 }, (_, i) => ({
      title: `Track ${i + 1}`,
    }));
    await db
      .update(shows)
      .set({
        setlists: {
          [PERFORMER_ID]: { sections: [{ kind: 'set', songs: longSetlist }] },
        },
      })
      .where(eq(shows.id, HEARD_SHOW_ID));

    const result = await createHeardPlaylist({
      userId: USER_ID,
      showId: HEARD_SHOW_ID,
    });
    assert.equal(result.trackCount, 150);
    // 150 / 100 → 2 batches.
    assert.equal(FETCH_LOG.tracksAdds.length, 2);
    assert.equal(FETCH_LOG.tracksAdds[0]!.uris.length, 100);
    assert.equal(FETCH_LOG.tracksAdds[1]!.uris.length, 50);
    // The second batch is pinned at position 100 so order is preserved.
    assert.equal(FETCH_LOG.tracksAdds[1]!.position, 100);
  });
});

describe('createHypePlaylist — predicted-setlist variant', () => {
  /**
   * The predicted-setlist algorithm needs enough corpus rows for at
   * least one song to land in the core bucket (probability ≥0.65).
   * We seed a uniform corpus where every row plays the same set, so
   * each song's Bayesian probability lands well above the cutoff.
   */
  async function seedThickCorpus(targetIso: string) {
    const baseDate = new Date(targetIso).getTime();
    const inserts = [];
    for (let i = 0; i < 6; i += 1) {
      const day = new Date(baseDate - (i + 1) * 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      inserts.push({
        id: fakeUuid(PREFIX, `corpus-${i}`),
        performerId: PERFORMER_ID,
        performanceDate: day,
        setlistfmId: `${PREFIX}cs-${i}`,
        setlist: {
          sections: [
            { kind: 'set' as const, songs: FAKE_SONGS.map((t) => ({ title: t })) },
          ],
        },
        songCount: FAKE_SONGS.length,
      });
    }
    await db.insert(tourSetlists).values(inserts).onConflictDoNothing();
  }

  it('builds a hype playlist from the predicted setlist', async () => {
    mockSpotify();
    await persistFreshToken();
    await deletePlaylistRows();
    await seedThickCorpus('2026-09-12');

    const result = await createHypePlaylist({
      userId: USER_ID,
      showId: HYPE_SHOW_ID,
    });
    assert.equal(result.reused, false);
    assert.ok(result.trackCount > 0);
    assert.equal(FETCH_LOG.playlistCreates.length, 1);
    assert.match(
      FETCH_LOG.playlistCreates[0]!.name,
      /^Hype: Phoebe Bridgers @ Test Arena · 2026-09-12$/,
    );
    // hype description carries the confidence segment
    assert.match(
      FETCH_LOG.playlistCreates[0]!.description,
      /Auto-generated by Showbook from .*setlist prediction/,
    );
  });
});

describe('festival per-performer playlists', () => {
  it('builds distinct heard playlists for each festival lineup performer', async () => {
    mockSpotify();
    await persistFreshToken();
    await deletePlaylistRows();

    // Headliner first.
    const headliner = await createHeardPlaylist({
      userId: USER_ID,
      showId: FESTIVAL_SHOW_ID,
      performerId: PERFORMER_ID,
    });
    assert.equal(headliner.reused, false);
    assert.equal(headliner.trackCount, FAKE_SONGS.length);
    const headlinerCreate =
      FETCH_LOG.playlistCreates[FETCH_LOG.playlistCreates.length - 1]!;
    assert.match(
      headlinerCreate.name,
      /^I Heard: Phoebe Bridgers @ Test Arena · 2024-08-15$/,
    );

    // Support artist on the same show + kind — the broken behavior
    // would return the headliner's row from the idempotency check
    // and skip a fresh Spotify create. With the per-performer index
    // we get a new playlist built from SUPPORT_SONGS.
    const support = await createHeardPlaylist({
      userId: USER_ID,
      showId: FESTIVAL_SHOW_ID,
      performerId: SUPPORT_PERFORMER_ID,
    });
    assert.equal(support.reused, false, 'support should not reuse headliner row');
    assert.notEqual(support.playlistId, headliner.playlistId);
    assert.equal(support.trackCount, SUPPORT_SONGS.length);
    const supportCreate =
      FETCH_LOG.playlistCreates[FETCH_LOG.playlistCreates.length - 1]!;
    assert.match(
      supportCreate.name,
      /^I Heard: Soccer Mommy @ Test Arena · 2024-08-15$/,
    );

    // Idempotency still holds within each performer scope.
    const supportAgain = await createHeardPlaylist({
      userId: USER_ID,
      showId: FESTIVAL_SHOW_ID,
      performerId: SUPPORT_PERFORMER_ID,
    });
    assert.equal(supportAgain.reused, true);
    assert.equal(supportAgain.playlistId, support.playlistId);

    // Both rows live in the table.
    const rows = await db
      .select()
      .from(showSpotifyPlaylists)
      .where(
        and(
          eq(showSpotifyPlaylists.userId, USER_ID),
          eq(showSpotifyPlaylists.showId, FESTIVAL_SHOW_ID),
        ),
      );
    assert.equal(rows.length, 2);
    const byPerformer = new Map(rows.map((r) => [r.performerId, r]));
    assert.ok(byPerformer.get(PERFORMER_ID));
    assert.ok(byPerformer.get(SUPPORT_PERFORMER_ID));
  });

  it('rejects performerId that is not in the show lineup', async () => {
    mockSpotify();
    await persistFreshToken();
    await deletePlaylistRows();

    const strangerId = fakeUuid(PREFIX, 'perf-stranger');
    await assert.rejects(
      createHeardPlaylist({
        userId: USER_ID,
        showId: FESTIVAL_SHOW_ID,
        performerId: strangerId,
      }),
      (err: Error) => {
        assert.match(err.message, /not in show lineup/i);
        return true;
      },
    );
    assert.equal(FETCH_LOG.playlistCreates.length, 0);
  });

  it('getExistingPlaylist returns null for a different performer than the persisted row', async () => {
    mockSpotify();
    await persistFreshToken();
    await deletePlaylistRows();

    await createHeardPlaylist({
      userId: USER_ID,
      showId: FESTIVAL_SHOW_ID,
      performerId: PERFORMER_ID,
    });

    const headlinerRow = await getExistingPlaylist({
      userId: USER_ID,
      showId: FESTIVAL_SHOW_ID,
      kind: 'heard',
      performerId: PERFORMER_ID,
    });
    assert.ok(headlinerRow);

    const supportRow = await getExistingPlaylist({
      userId: USER_ID,
      showId: FESTIVAL_SHOW_ID,
      kind: 'heard',
      performerId: SUPPORT_PERFORMER_ID,
    });
    assert.equal(supportRow, null);
  });
});

describe('disconnect cleans up playlist rows', () => {
  it('disconnectSpotify deletes show_spotify_playlists rows for the user', async () => {
    mockSpotify();
    await persistFreshToken();
    await createHeardPlaylist({ userId: USER_ID, showId: HEARD_SHOW_ID });

    const before = await getExistingPlaylist({
      userId: USER_ID,
      showId: HEARD_SHOW_ID,
      kind: 'heard',
    });
    assert.ok(before, 'row exists before disconnect');

    await disconnectSpotify(USER_ID, 'user_disconnect');

    const after = await getExistingPlaylist({
      userId: USER_ID,
      showId: HEARD_SHOW_ID,
      kind: 'heard',
    });
    assert.equal(after, null, 'row purged on disconnect');
  });
});
