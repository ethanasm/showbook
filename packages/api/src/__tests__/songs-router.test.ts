/**
 * Unit suite for the new `songs` router (Phase 2). Two layers:
 *
 *  1. The pure `rowIsUserDebut` helper that powers the `tourDebutOnly`
 *     filter — assert it returns true only when the user has a single
 *     attended occurrence of the song. The query itself shells out to
 *     postgres, but this filter runs in JS afterwards.
 *  2. The router-level `list` call against the fake-db, asserting the
 *     `firstHeardOnly` and `tourDebutOnly` post-filters narrow the
 *     scripted rows the way the UI expects.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { songsRouter, rowIsUserDebut } from '../routers/songs';
import { fakeCtx, makeFakeDb } from './_fake-db';
import { fakeUuid } from './_test-helpers';

const USER_ID = 'songs-test-user';

describe('rowIsUserDebut', () => {
  test('true when first === last AND timesHeard === 1', () => {
    assert.equal(
      rowIsUserDebut({ timesHeard: 1, firstHeard: '2025-01-01', lastHeard: '2025-01-01' }),
      true,
    );
  });
  test('false when heard more than once (different dates)', () => {
    assert.equal(
      rowIsUserDebut({ timesHeard: 2, firstHeard: '2024-01-01', lastHeard: '2025-01-01' }),
      false,
    );
  });
  test('false when heard twice on the same date (unusual but possible)', () => {
    // Two attended performers on the same festival night could cover
    // the same song; we count that as "heard twice" so it doesn't
    // qualify as a debut.
    assert.equal(
      rowIsUserDebut({ timesHeard: 2, firstHeard: '2025-01-01', lastHeard: '2025-01-01' }),
      false,
    );
  });
});

describe('songsRouter.list filter pipeline', () => {
  const SONG_ONCE = fakeUuid('s', 'once');
  const SONG_TWICE = fakeUuid('s', 'twice');
  const PERF = fakeUuid('p', 'perf');

  const SCRIPTED_ROWS = [
    {
      songId: SONG_ONCE,
      performerId: PERF,
      performerName: 'Performer',
      title: 'Bloodbuzz Ohio',
      timesHeard: 1,
      firstHeard: '2025-09-15',
      lastHeard: '2025-09-15',
    },
    {
      songId: SONG_TWICE,
      performerId: PERF,
      performerName: 'Performer',
      title: 'Mr November',
      timesHeard: 2,
      firstHeard: '2023-05-10',
      lastHeard: '2025-09-15',
    },
  ];

  test('unfiltered list returns every grouped row with the `isUserDebut` flag computed', async () => {
    const db = makeFakeDb({ selectResults: [SCRIPTED_ROWS] });
    const caller = songsRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const out = await caller.list({
      firstHeardOnly: false,
      tourDebutOnly: false,
      limit: 200,
    });
    assert.equal(out.length, 2);
    assert.equal(out[0]!.isUserDebut, true);
    assert.equal(out[1]!.isUserDebut, false);
  });

  test('firstHeardOnly drops songs the user has heard more than once', async () => {
    const db = makeFakeDb({ selectResults: [SCRIPTED_ROWS] });
    const caller = songsRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const out = await caller.list({
      firstHeardOnly: true,
      tourDebutOnly: false,
      limit: 200,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.songId, SONG_ONCE);
  });

  test('tourDebutOnly is the same shape (timesHeard === 1 AND first === last)', async () => {
    const db = makeFakeDb({ selectResults: [SCRIPTED_ROWS] });
    const caller = songsRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const out = await caller.list({
      firstHeardOnly: false,
      tourDebutOnly: true,
      limit: 200,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.songId, SONG_ONCE);
  });

  test('tourDebutOnly + firstHeardOnly both narrow to the singleton row', async () => {
    const db = makeFakeDb({ selectResults: [SCRIPTED_ROWS] });
    const caller = songsRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const out = await caller.list({
      firstHeardOnly: true,
      tourDebutOnly: true,
      limit: 200,
    });
    // tourDebutOnly takes precedence; both should still produce the
    // same single row.
    assert.equal(out.length, 1);
  });
});
