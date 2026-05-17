/**
 * Phase 11 §15f — set-count prediction helper unit tests.
 *
 * The four style predictors each populate a top-level
 * `setCountPrediction` from this module; the helpers must produce a
 * consistent shape regardless of source.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSetCount,
  setCountFromShowModes,
  setCountFromSingleCount,
} from '../setlist-predict-shared';
import type { CorpusRow } from '../setlist-predict';
import type { PerformerSetlist } from '@showbook/shared';

function setlist(songCount: number, setCount: number): PerformerSetlist {
  const sections = [];
  const songsPerSet = Math.ceil(songCount / setCount);
  for (let i = 0; i < setCount; i++) {
    const start = i * songsPerSet;
    const songs = Array.from(
      { length: Math.min(songsPerSet, songCount - start) },
      (_, j) => ({ title: `Song ${start + j + 1}` }),
    );
    sections.push({ kind: 'set' as const, songs });
  }
  return { sections };
}

function row(date: string, songCount: number, setCount = 1): CorpusRow {
  return {
    id: `row-${date}`,
    performerId: 'perf-1',
    performanceDate: date,
    tourId: null,
    tourName: null,
    setlist: setlist(songCount, setCount),
    songCount,
    fetchedAt: new Date(`${date}T12:00:00Z`),
  };
}

describe('computeSetCount', () => {
  test('returns null when sampleSize < 3', () => {
    assert.equal(computeSetCount([]), null);
    assert.equal(computeSetCount([row('2025-01-01', 20)]), null);
    assert.equal(computeSetCount([row('2025-01-01', 20), row('2025-01-02', 20)]), null);
  });

  test('returns the mode of set counts when most shows are 2-set', () => {
    const corpus = [
      row('2025-01-01', 18, 2),
      row('2025-01-02', 18, 2),
      row('2025-01-03', 18, 2),
      row('2025-01-04', 21, 1),
    ];
    const result = computeSetCount(corpus);
    assert.ok(result);
    assert.equal(result.setCount, 2);
    assert.ok(result.setCountConfidence > 0.7);
  });

  test('produces percentile-aware song count', () => {
    const corpus = [
      row('2025-01-01', 14),
      row('2025-01-02', 16),
      row('2025-01-03', 17),
      row('2025-01-04', 19),
      row('2025-01-05', 22),
    ];
    const result = computeSetCount(corpus);
    assert.ok(result);
    assert.equal(result.expectedSongCount.p50, 17);
    assert.ok(result.expectedSongCount.p25 <= result.expectedSongCount.p50);
    assert.ok(result.expectedSongCount.p75 >= result.expectedSongCount.p50);
  });

  test('ignores synthetic rows in the count', () => {
    const real = [row('2025-01-01', 20), row('2025-01-02', 20), row('2025-01-03', 20)];
    const synthetic: CorpusRow = {
      ...row('2025-01-04', 3),
      isSynthetic: true,
      syntheticAlbumName: 'New Album',
    };
    const result = computeSetCount([...real, synthetic]);
    assert.ok(result);
    assert.equal(result.expectedSongCount.p50, 20);
  });

  test('expectedDurationMin is null when corpus has no duration data', () => {
    const corpus = [
      row('2025-01-01', 18),
      row('2025-01-02', 18),
      row('2025-01-03', 18),
    ];
    const result = computeSetCount(corpus);
    assert.ok(result);
    // PerformerSetlist doesn't carry duration today — should be null.
    assert.equal(result.expectedDurationMin, null);
  });
});

describe('setCountFromSingleCount', () => {
  test('packs a scalar into the uniform shape', () => {
    const r = setCountFromSingleCount(39);
    assert.equal(r.setCount, 1);
    assert.equal(r.expectedSongCount.p25, 39);
    assert.equal(r.expectedSongCount.p50, 39);
    assert.equal(r.expectedSongCount.p75, 39);
    assert.equal(r.expectedDurationMin, null);
  });
});

describe('setCountFromShowModes', () => {
  test('weights expected song count by mode probability', () => {
    const modes = [
      { probability: 0.6, expectedSongCount: 11 },
      { probability: 0.3, expectedSongCount: 26 },
      { probability: 0.1, expectedSongCount: 14 },
    ];
    const r = setCountFromShowModes(modes);
    assert.ok(r);
    // 0.6*11 + 0.3*26 + 0.1*14 = 6.6 + 7.8 + 1.4 = 15.8 → rounds to 16
    assert.equal(r.expectedSongCount.p50, 16);
    assert.equal(r.expectedSongCount.p25, 11);
    assert.equal(r.expectedSongCount.p75, 26);
  });

  test('returns null on empty modes', () => {
    assert.equal(setCountFromShowModes([]), null);
  });
});
