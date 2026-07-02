/**
 * Unit suite for the `songs` router. Two layers:
 *
 *  1. The pure `rowIsUserDebut` helper that powers the `isUserDebut`
 *     flag (the artist page's "🆕 Once" badge) — assert it returns
 *     true only when the user has a single attended occurrence of the
 *     song. The query itself shells out to postgres, but this flag is
 *     computed in JS afterwards.
 *  2. The router-level `list` call against the fake-db, asserting the
 *     grouped rows come back with the flag computed.
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

describe('songsRouter.list', () => {
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

  test('returns every grouped row with the `isUserDebut` flag computed', async () => {
    const db = makeFakeDb({ selectResults: [SCRIPTED_ROWS] });
    const caller = songsRouter.createCaller(fakeCtx(db, USER_ID) as any);
    const out = await caller.list({ limit: 200 });
    assert.equal(out.length, 2);
    assert.equal(out[0]!.isUserDebut, true);
    assert.equal(out[1]!.isUserDebut, false);
  });

});
