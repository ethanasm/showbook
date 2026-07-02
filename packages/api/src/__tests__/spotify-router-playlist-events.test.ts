/**
 * Unit test: the `spotify.createHypePlaylist` /
 * `spotify.createHeardPlaylist` router mutations emit the
 * `spotify.playlist.{hype,heard}_{created,reused}` structured log
 * events with the expected payload shape.
 *
 * The underlying `createHypePlaylist` / `createHeardPlaylist`
 * functions (in `spotify-playlist.ts`) are mocked via
 * `mock.module` so this test asserts only the router-level
 * observability wiring, not the playlist orchestration.
 */

import { describe, it, before, mock } from 'node:test';
import assert from 'node:assert/strict';

interface LogCall {
  event?: string;
  userId?: string;
  showId?: string;
  performerId?: string | null;
  playlistId?: string;
  trackCount?: number;
  requested?: number;
  missingCount?: number;
  cacheHits?: number;
  cacheMisses?: number;
  durationMs?: number;
}

const LOG_CALLS: LogCall[] = [];

mock.module('@showbook/observability', {
  namedExports: {
    child: () => ({
      info: (payload: LogCall) => LOG_CALLS.push(payload),
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    }),
  },
});

interface MockCall {
  userId: string;
  showId: string;
  performerId?: string;
}
const HYPE_CALLS: MockCall[] = [];
const HEARD_CALLS: MockCall[] = [];

interface MockResult {
  playlistId: string;
  spotifyUrl: string;
  trackCount: number;
  durationMs: number;
  requested: number;
  missing: string[];
  reused: boolean;
  cacheHits?: number;
  cacheMisses?: number;
}

const HYPE_RESULT: MockResult = {
  playlistId: 'pl_hype_abc',
  spotifyUrl: 'https://open.spotify.com/playlist/pl_hype_abc',
  trackCount: 12,
  durationMs: 2_400_000,
  requested: 14,
  missing: ['Skipped Title', 'Another Skip'],
  reused: false,
  // Cache telemetry returned by executePlaylistCreate on fresh creates —
  // the router folds these into the *_created events (the helper's own
  // `spotify.*_playlist.created` log was removed as a duplicate).
  cacheHits: 9,
  cacheMisses: 5,
};

const HEARD_RESULT: MockResult = {
  ...HYPE_RESULT,
  playlistId: 'pl_heard_abc',
  spotifyUrl: 'https://open.spotify.com/playlist/pl_heard_abc',
  reused: false,
};

// Reused rows come from the idempotency short-circuit, which has no
// per-call resolution telemetry.
const REUSED_HYPE: MockResult = {
  ...HYPE_RESULT,
  reused: true,
  missing: [],
  cacheHits: undefined,
  cacheMisses: undefined,
};
const REUSED_HEARD: MockResult = {
  ...HEARD_RESULT,
  reused: true,
  missing: [],
  cacheHits: undefined,
  cacheMisses: undefined,
};

let nextHype = HYPE_RESULT;
let nextHeard = HEARD_RESULT;

mock.module('../spotify-playlist.js', {
  namedExports: {
    createHypePlaylist: async (input: MockCall) => {
      HYPE_CALLS.push(input);
      return nextHype;
    },
    createHeardPlaylist: async (input: MockCall) => {
      HEARD_CALLS.push(input);
      return nextHeard;
    },
    getExistingPlaylist: async () => null,
  },
});

let spotifyRouter: typeof import('../routers/spotify').spotifyRouter;
before(async () => {
  ({ spotifyRouter } = await import('../routers/spotify'));
});

function fakeCtxFor(userId: string) {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ email: `${userId}@admin.local` }],
          }),
        }),
      }),
    },
    session: { user: { id: userId } },
  };
}

const SHOW_ID = '11111111-1111-4111-8111-111111111111';
const PERFORMER_ID = '22222222-2222-4222-8222-222222222222';

describe('spotify router — playlist mutation events', () => {
  it('emits spotify.playlist.hype_created with full payload on a fresh create', async () => {
    LOG_CALLS.length = 0;
    nextHype = HYPE_RESULT;
    const caller = spotifyRouter.createCaller(fakeCtxFor('user-1') as never);
    await caller.createHypePlaylist({ showId: SHOW_ID });
    const created = LOG_CALLS.find(
      (c) => c.event === 'spotify.playlist.hype_created',
    );
    assert.ok(created, 'expected hype_created event');
    assert.equal(created.userId, 'user-1');
    assert.equal(created.showId, SHOW_ID);
    assert.equal(created.playlistId, 'pl_hype_abc');
    assert.equal(created.trackCount, 12);
    assert.equal(created.missingCount, 2);
    // Resolution telemetry folded in from the helper's result (previously
    // only carried by the removed `spotify.hype_playlist.created` log).
    assert.equal(created.requested, 14);
    assert.equal(created.cacheHits, 9);
    assert.equal(created.cacheMisses, 5);
    assert.equal(typeof created.durationMs, 'number');
  });

  it('emits spotify.playlist.hype_reused (no missingCount) when the idempotency short-circuit hits', async () => {
    LOG_CALLS.length = 0;
    nextHype = REUSED_HYPE;
    const caller = spotifyRouter.createCaller(fakeCtxFor('user-2') as never);
    await caller.createHypePlaylist({ showId: SHOW_ID });
    const reused = LOG_CALLS.find(
      (c) => c.event === 'spotify.playlist.hype_reused',
    );
    assert.ok(reused, 'expected hype_reused event');
    assert.equal(reused.playlistId, 'pl_hype_abc');
    assert.equal(reused.trackCount, 12);
    // hype_reused intentionally omits missingCount (the reused row has
    // no per-call missing-titles list).
    assert.equal(reused.missingCount, undefined);
    // The created variant should NOT fire when reused.
    assert.equal(
      LOG_CALLS.some((c) => c.event === 'spotify.playlist.hype_created'),
      false,
    );
  });

  it('emits spotify.playlist.heard_created on a fresh heard playlist create', async () => {
    LOG_CALLS.length = 0;
    nextHeard = HEARD_RESULT;
    const caller = spotifyRouter.createCaller(fakeCtxFor('user-3') as never);
    await caller.createHeardPlaylist({ showId: SHOW_ID });
    const created = LOG_CALLS.find(
      (c) => c.event === 'spotify.playlist.heard_created',
    );
    assert.ok(created, 'expected heard_created event');
    assert.equal(created.userId, 'user-3');
    assert.equal(created.showId, SHOW_ID);
    assert.equal(created.playlistId, 'pl_heard_abc');
    assert.equal(created.trackCount, 12);
    assert.equal(created.missingCount, 2);
    assert.equal(created.requested, 14);
    assert.equal(created.cacheHits, 9);
    assert.equal(created.cacheMisses, 5);
  });

  it('emits spotify.playlist.heard_reused on the heard idempotency short-circuit', async () => {
    LOG_CALLS.length = 0;
    nextHeard = REUSED_HEARD;
    const caller = spotifyRouter.createCaller(fakeCtxFor('user-4') as never);
    await caller.createHeardPlaylist({ showId: SHOW_ID });
    const reused = LOG_CALLS.find(
      (c) => c.event === 'spotify.playlist.heard_reused',
    );
    assert.ok(reused, 'expected heard_reused event');
    assert.equal(reused.playlistId, 'pl_heard_abc');
    assert.equal(reused.missingCount, undefined);
  });

  it('forwards a festival performerId to createHypePlaylist and tags the log line', async () => {
    LOG_CALLS.length = 0;
    HYPE_CALLS.length = 0;
    nextHype = HYPE_RESULT;
    const caller = spotifyRouter.createCaller(fakeCtxFor('user-5') as never);
    await caller.createHypePlaylist({ showId: SHOW_ID, performerId: PERFORMER_ID });
    assert.equal(HYPE_CALLS.length, 1);
    assert.equal(HYPE_CALLS[0]!.performerId, PERFORMER_ID);
    const created = LOG_CALLS.find(
      (c) => c.event === 'spotify.playlist.hype_created',
    );
    assert.ok(created, 'expected hype_created event');
    assert.equal(created.performerId, PERFORMER_ID);
  });

  it('forwards a festival performerId to createHeardPlaylist and tags the log line', async () => {
    LOG_CALLS.length = 0;
    HEARD_CALLS.length = 0;
    nextHeard = HEARD_RESULT;
    const caller = spotifyRouter.createCaller(fakeCtxFor('user-6') as never);
    await caller.createHeardPlaylist({ showId: SHOW_ID, performerId: PERFORMER_ID });
    assert.equal(HEARD_CALLS.length, 1);
    assert.equal(HEARD_CALLS[0]!.performerId, PERFORMER_ID);
    const created = LOG_CALLS.find(
      (c) => c.event === 'spotify.playlist.heard_created',
    );
    assert.ok(created, 'expected heard_created event');
    assert.equal(created.performerId, PERFORMER_ID);
  });
});
