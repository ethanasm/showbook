/**
 * Unit tests for the Phase 7 year-end-soundtrack scoring + ordering
 * helpers. The DB-touching path lives behind the integration test
 * (or future schema-scan); here we just verify the pure logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickSignatureTracks, djSetOrder } from '../year-end-soundtrack';

interface Cand {
  songId: string;
  spotifyTrackId: string;
  popularity: number;
  performerId: string;
  performerName: string;
  playedCount: number;
}

function c(opts: Partial<Cand> & { id: string; played?: number; pop?: number }): Cand {
  return {
    songId: opts.id,
    spotifyTrackId: `tr-${opts.id}`,
    popularity: opts.pop ?? 50,
    performerId: 'perf-1',
    performerName: 'Test Artist',
    playedCount: opts.played ?? 1,
  };
}

describe('pickSignatureTracks', () => {
  it('boosts tracks in the user top set', () => {
    const tracks = [
      c({ id: 'a', played: 1, pop: 50 }),
      c({ id: 'b', played: 1, pop: 50 }),
    ];
    // 'a' is in the top tracks → scores 1*50*2=100; 'b' scores 1*50*1=50.
    const result = pickSignatureTracks(tracks, new Set(['tr-a']));
    assert.equal(result[0]?.spotifyTrackId, 'tr-a');
    assert.equal(result[1]?.spotifyTrackId, 'tr-b');
  });

  it('weights by played count', () => {
    const tracks = [
      c({ id: 'a', played: 1, pop: 100 }),
      c({ id: 'b', played: 5, pop: 50 }),
    ];
    // a: 1*100*1=100; b: 5*50*1=250 → b wins.
    const result = pickSignatureTracks(tracks, new Set());
    assert.equal(result[0]?.spotifyTrackId, 'tr-b');
  });

  it('dedupes by spotifyTrackId, keeping the highest-scored', () => {
    const tracks = [
      c({ id: 'a', played: 1, pop: 50 }),
      c({ id: 'a', played: 3, pop: 50 }),
    ];
    const result = pickSignatureTracks(tracks, new Set());
    assert.equal(result.length, 1);
    // Score: 3*50*1=150 wins over 1*50*1=50.
    assert.equal(result[0]?.popularity, 150);
  });

  it('returns empty array for empty input', () => {
    const result = pickSignatureTracks([], new Set());
    assert.deepEqual(result, []);
  });
});

describe('djSetOrder', () => {
  it('passes through arrays of length ≤2', () => {
    const a = [c({ id: 'a' })];
    assert.deepEqual(djSetOrder(a), a);
    const b = [c({ id: 'a' }), c({ id: 'b' })];
    assert.deepEqual(djSetOrder(b), b);
  });

  it('arranges peaks mid-playlist with quieter bookends', () => {
    // popularity already encodes the score from pickSignatureTracks.
    const sorted = [
      c({ id: 'pk1', pop: 100 }),
      c({ id: 'pk2', pop: 95 }),
      c({ id: 'pk3', pop: 90 }),
      c({ id: 'mid', pop: 70 }),
      c({ id: 'low1', pop: 50 }),
      c({ id: 'low2', pop: 30 }),
    ];
    const ordered = djSetOrder(sorted);
    // The full set is preserved.
    assert.equal(ordered.length, sorted.length);
    const ids = new Set(ordered.map((c) => c.songId));
    assert.equal(ids.size, sorted.length);
    // The highest-scoring track lands somewhere in the middle band
    // (not at index 0 or the final index), and the lowest scores
    // bookend (warm-up + wind-down).
    const peakIndex = ordered.findIndex((c) => c.songId === 'pk1');
    assert.ok(
      peakIndex > 0 && peakIndex < ordered.length - 1,
      `peak should land mid-playlist, got index ${peakIndex}`,
    );
    const firstPop = ordered[0]?.popularity ?? 0;
    const lastPop = ordered[ordered.length - 1]?.popularity ?? 0;
    const midPop = ordered[Math.floor(ordered.length / 2)]?.popularity ?? 0;
    assert.ok(
      midPop >= firstPop && midPop >= lastPop,
      `mid popularity ${midPop} should peak vs bookends ${firstPop} / ${lastPop}`,
    );
  });
});
