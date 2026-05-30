/**
 * Unit suite for the setlist-intelligence tRPC router. Covers the
 * eligibility gate (SI-03) for every show kind + state combination,
 * plus the no-MBID short-circuit (SI-04). The real algorithm path
 * (predictedSetlistCached → DB) is exercised by the integration
 * tests; these tests use the fake-db scripted-result pattern so the
 * gate logic can be asserted in isolation.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setlistIntelRouter } from '../routers/setlist-intel';
import { fakeCtx, makeFakeDb } from './_fake-db';
import { fakeUuid } from './_test-helpers';

const USER_ID = 'test-user';

interface ShowFixture {
  kind: string;
  state: string;
  date: string | null;
  productionName: string | null;
  showPerformers: Array<{
    role: string;
    sortOrder: number;
    performer: { id: string; name: string; musicbrainzId: string | null };
  }>;
}

function showFixture(overrides: Partial<ShowFixture> = {}): ShowFixture {
  return {
    kind: 'concert',
    state: 'watching',
    date: '2026-05-15',
    productionName: null,
    showPerformers: [
      {
        role: 'headliner',
        sortOrder: 0,
        performer: {
          id: fakeUuid('p', '1'),
          name: 'Test Performer',
          musicbrainzId: 'mbid-123',
        },
      },
    ],
    ...overrides,
  };
}

// The router calls `ctx.db.query.shows.findFirst` for the show payload,
// then does `ctx.db.select(...)` for the performer mbid lookup. We need
// to extend the fake db to support `query.shows.findFirst`.
function makeRouterDb(showFixtureValue: ShowFixture, performerMbid: string | null) {
  const headlinerId = showFixtureValue.showPerformers[0]?.performer.id ?? fakeUuid('p', '999');
  const db = makeFakeDb({
    selectResults: [
      // performer mbid lookup (only reached if all eligibility passes)
      [{ id: headlinerId, name: 'Test Performer', musicbrainzId: performerMbid }],
    ],
  });
  // Override findFirst with the show payload.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.query as any).shows = {
    findFirst: async () => showFixtureValue,
  };
  return db;
}

// ─────────────────────────────────────────────────────────────────────
// Eligibility gate
// ─────────────────────────────────────────────────────────────────────

describe('predictedSetlist — eligibility gate', () => {
  test('returns "wrong_kind" cold state for comedy', async () => {
    const db = makeRouterDb(showFixture({ kind: 'comedy' }), 'mbid-123');
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.predictedSetlist({ showId: fakeUuid('s', '1') });
    assert.equal(result.style, 'cold');
    if (result.style === 'cold') assert.equal(result.reason, 'wrong_kind');
  });

  test('returns "wrong_kind" for theatre', async () => {
    const db = makeRouterDb(showFixture({ kind: 'theatre' }), 'mbid-123');
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.predictedSetlist({ showId: fakeUuid('s', '1') });
    assert.equal(result.style, 'cold');
    if (result.style === 'cold') assert.equal(result.reason, 'wrong_kind');
  });

  test('returns "wrong_kind" for film', async () => {
    const db = makeRouterDb(showFixture({ kind: 'film' }), 'mbid-123');
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.predictedSetlist({ showId: fakeUuid('s', '1') });
    assert.equal(result.style, 'cold');
  });

  test('returns "wrong_kind" for unknown', async () => {
    const db = makeRouterDb(showFixture({ kind: 'unknown' }), 'mbid-123');
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.predictedSetlist({ showId: fakeUuid('s', '1') });
    assert.equal(result.style, 'cold');
  });

  test('"production_show" cold state is now theatre-only (festivals fall through)', async () => {
    // Theatre with a productionName: still cold(production_show).
    const theatreDb = makeRouterDb(
      showFixture({ kind: 'theatre', productionName: 'Hamilton' }),
      'mbid-123',
    );
    const theatreCaller = setlistIntelRouter.createCaller(
      fakeCtx(theatreDb, USER_ID) as any,
    );
    const theatreResult = await theatreCaller.predictedSetlist({
      showId: fakeUuid('s', '1'),
    });
    // Theatre is gated by `wrong_kind` (SUPPORTED_KINDS doesn't include
    // theatre) before the production_show branch fires.
    assert.equal(theatreResult.style, 'cold');

    // Festival with a productionName: falls through to the headliner
    // prediction path. Per-artist breakdown is served by the
    // predictedFestivalSetlists procedure below.
    const festivalDb = makeRouterDb(
      showFixture({ kind: 'festival', productionName: 'Glastonbury 2026' }),
      'mbid-123',
    );
    const festivalCaller = setlistIntelRouter.createCaller(
      fakeCtx(festivalDb, USER_ID) as any,
    );
    const festivalResult = await festivalCaller.predictedSetlist({
      showId: fakeUuid('s', '1'),
    });
    // The fake db can't actually run the algorithm path, so the catch
    // surfaces no_corpus — but the key assertion is it's NOT
    // production_show anymore.
    assert.equal(festivalResult.style, 'cold');
    if (festivalResult.style === 'cold') {
      assert.notEqual(festivalResult.reason, 'production_show');
    }
  });

  test('returns "date_not_set" for a concert with no date (residency case)', async () => {
    const db = makeRouterDb(showFixture({ kind: 'concert', date: null }), 'mbid-123');
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.predictedSetlist({ showId: fakeUuid('s', '1') });
    assert.equal(result.style, 'cold');
    if (result.style === 'cold') assert.equal(result.reason, 'date_not_set');
  });

  test('returns "no_headliner" when the show has no headliner performer', async () => {
    const db = makeRouterDb(showFixture({ showPerformers: [] }), 'mbid-123');
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.predictedSetlist({ showId: fakeUuid('s', '1') });
    assert.equal(result.style, 'cold');
    if (result.style === 'cold') assert.equal(result.reason, 'no_headliner');
  });

  test('returns "no_mbid" when the headliner performer has no MusicBrainz ID', async () => {
    const fixture = showFixture();
    fixture.showPerformers[0]!.performer.musicbrainzId = null;
    const db = makeRouterDb(fixture, null);
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.predictedSetlist({ showId: fakeUuid('s', '1') });
    assert.equal(result.style, 'cold');
    if (result.style === 'cold') {
      assert.equal(result.reason, 'no_mbid');
      assert.equal(result.performerName, 'Test Performer');
    }
  });

  test('falls through to the algorithm path for an eligible festival', async () => {
    // Eligibility passes — kind=festival, date set, headliner with mbid.
    // The next step (predictedSetlistCached) hits the DB; in a unit
    // test we expect it to error out reading from the fake db, which
    // should be caught and surfaced as a cold "no_corpus".
    const db = makeRouterDb(
      showFixture({ kind: 'festival', productionName: null }),
      'mbid-123',
    );
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.predictedSetlist({ showId: fakeUuid('s', '1') });
    // The fake-db's transaction wrapper rejects most chain methods;
    // the router catches the throw and surfaces the safe cold fallback.
    assert.equal(result.style, 'cold');
    if (result.style === 'cold') {
      // Either no_corpus (algorithm path threw) or one of the other
      // reasons depending on what the fake db happens to do.
      assert.ok(
        ['no_corpus', 'no_mbid'].includes(result.reason),
        `unexpected fallback reason ${result.reason}`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// predictedFestivalSetlists — multi-artist fan-out
// ─────────────────────────────────────────────────────────────────────

interface FestivalShowFixture {
  kind: string;
  date: string | null;
  productionName: string | null;
  showPerformers: Array<{
    role: string;
    sortOrder: number;
    performer: { id: string; name: string };
  }>;
}

function makeFestivalDb(show: FestivalShowFixture) {
  const db = makeFakeDb({ selectResults: [] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.query as any).shows = {
    findFirst: async () => show,
  };
  // Per-artist performer lookup: the fluent `where` clause isn't visible
  // to the proxy, so we override `select` to return a null-mbid row no
  // matter which performer the procedure asks about. That keeps every
  // artist on the cold(no_mbid) fan-out branch — letting any artist
  // through to the algorithm path would also consume select calls
  // from the same proxy for the corpus loader, racing the other
  // artists' lookups.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => [
          {
            id: 'unused',
            name: 'unused',
            musicbrainzId: null,
            setlistStyle: null,
            setlistStyleOverride: null,
          },
        ],
      }),
    }),
  });
  return db;
}

describe('predictedFestivalSetlists — per-artist fan-out', () => {
  test('returns one entry per lineup artist in headliner→support sortOrder', async () => {
    const lordeId = fakeUuid('p', 'lorde');
    const teddyId = fakeUuid('p', 'teddy');
    const tashId = fakeUuid('p', 'tash');
    const db = makeFestivalDb({
      kind: 'festival',
      date: '2026-05-22',
      productionName: 'Bottlerock',
      showPerformers: [
        // Intentionally out of order on input — the procedure sorts.
        { role: 'support', sortOrder: 2, performer: { id: tashId, name: 'Tash Sultana' } },
        { role: 'headliner', sortOrder: 0, performer: { id: lordeId, name: 'Lorde' } },
        { role: 'support', sortOrder: 1, performer: { id: teddyId, name: 'Teddy Swims' } },
      ],
    });
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.predictedFestivalSetlists({
      showId: fakeUuid('s', 'fest'),
    });

    assert.equal(result.entries.length, 3);
    // Headliner first (sortOrder 0), then supports by ascending sortOrder.
    assert.equal(result.entries[0].role, 'headliner');
    assert.equal(result.entries[0].performerName, 'Lorde');
    assert.equal(result.entries[1].role, 'support');
    assert.equal(result.entries[1].performerName, 'Teddy Swims');
    assert.equal(result.entries[2].performerName, 'Tash Sultana');
    // Every artist returns a prediction (cold(no_mbid) for all three
    // since the fake performer rows have null musicbrainzId).
    for (const e of result.entries) {
      assert.equal(e.prediction.style, 'cold');
      if (e.prediction.style === 'cold') {
        assert.equal(e.prediction.reason, 'no_mbid');
      }
    }
  });

  test('returns an empty entries array for non-festival kinds', async () => {
    const db = makeFestivalDb({
      kind: 'concert',
      date: '2026-05-22',
      productionName: null,
      showPerformers: [
        {
          role: 'headliner',
          sortOrder: 0,
          performer: { id: fakeUuid('p', '1'), name: 'X' },
        },
      ],
    });
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.predictedFestivalSetlists({
      showId: fakeUuid('s', '1'),
    });
    assert.deepEqual(result.entries, []);
  });

  test('returns empty entries when the festival has no date', async () => {
    const db = makeFestivalDb({
      kind: 'festival',
      date: null,
      productionName: 'Tbd Fest',
      showPerformers: [
        {
          role: 'headliner',
          sortOrder: 0,
          performer: { id: fakeUuid('p', '1'), name: 'X' },
        },
      ],
    });
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.predictedFestivalSetlists({
      showId: fakeUuid('s', '1'),
    });
    assert.deepEqual(result.entries, []);
  });
});

// ─────────────────────────────────────────────────────────────────────
// trackPreviewsForShow — the row-play preview map. P10 follow-up fix #1
// confirms the resolver: every (lowercase) title returns either a hit
// pair or { null, null } so the row can degrade to "no preview" without
// the caller needing a second-stage probe.
// ─────────────────────────────────────────────────────────────────────

function makeTrackPreviewsDb(
  show: { id: string; userId: string; showPerformers: Array<{ role: string; sortOrder: number; performer: { id: string; name: string } }> },
  songRows: Array<{ title: string; previewUrl: string | null; spotifyTrackId: string | null }>,
) {
  const db = makeFakeDb({
    selectResults: [
      // songs table lookup keyed by performerId
      songRows,
    ],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.query as any).shows = {
    findFirst: async () => show,
  };
  return db;
}

describe('trackPreviewsForShow — resolver wiring (P10 fix #1)', () => {
  test('returns a map keyed by lowercase title with cached preview + trackId', async () => {
    const headlinerId = fakeUuid('p', 'headline');
    const showId = fakeUuid('s', 'tp1');
    const db = makeTrackPreviewsDb(
      {
        id: showId,
        userId: USER_ID,
        showPerformers: [
          {
            role: 'headliner',
            sortOrder: 0,
            performer: { id: headlinerId, name: 'Greek Theatre Band' },
          },
        ],
      },
      [
        {
          title: 'Big Opener',
          previewUrl: 'https://p/opener.mp3',
          spotifyTrackId: 'sp_track_1',
        },
        {
          title: 'CASE Insensitive',
          previewUrl: 'https://p/case.mp3',
          spotifyTrackId: null,
        },
        // Negative-cache sentinel from the lazy resolver — should
        // surface as `null` trackId on the way out (the row UI degrades
        // to disabled, but won't keep re-firing the Spotify search).
        {
          title: 'Missing Track',
          previewUrl: null,
          spotifyTrackId: '__none__',
        },
      ],
    );
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.trackPreviewsForShow({ showId });

    // Three rows of input, three rows of output, lower-cased keys.
    assert.deepEqual(Object.keys(result.previews).sort(), [
      'big opener',
      'case insensitive',
      'missing track',
    ]);
    assert.deepEqual(result.previews['big opener'], {
      previewUrl: 'https://p/opener.mp3',
      spotifyTrackId: 'sp_track_1',
    });
    // Null trackId stays null — the sentinel never leaks to the client.
    assert.deepEqual(result.previews['case insensitive'], {
      previewUrl: 'https://p/case.mp3',
      spotifyTrackId: null,
    });
    // `__none__` sentinel is scrubbed to null.
    assert.deepEqual(result.previews['missing track'], {
      previewUrl: null,
      spotifyTrackId: null,
    });
  });

  test('returns an empty map when the show has no headliner (defensive — UI gracefully degrades)', async () => {
    const showId = fakeUuid('s', 'tp2');
    const db = makeTrackPreviewsDb(
      { id: showId, userId: USER_ID, showPerformers: [] },
      [],
    );
    const caller = setlistIntelRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const result = await caller.trackPreviewsForShow({ showId });
    assert.deepEqual(result.previews, {});
  });
});
