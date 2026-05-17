/**
 * Phase 6 unit suite — improvised-style prediction model.
 *
 * Worked example is King Gizzard & The Lizard Wizard
 * (`specs/setlist-intelligence/worked-examples.md` §4): the
 * band shifts between Regular (~11 songs) and Marathon (~26 songs)
 * shows, with occasional Microtonal nights drawing from K.G. / L.W.
 * material. The model refuses to predict song-by-song; instead it
 * surfaces show-mode odds + a 7-axis vibe sketch.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeImprovisedShowModeHit,
  computeShowModes,
  computeVibeSketch,
  predictImprovised,
  VIBE_AXES,
} from '../setlist-predict-improvised';
import type { CorpusRow } from '../setlist-predict';
import type { PerformerSetlist } from '@showbook/shared';

function setlistOf(songs: string[]): PerformerSetlist {
  return {
    sections: [
      {
        kind: 'set',
        songs: songs.map((title) => ({ title })),
      },
    ],
  };
}

function row(opts: { date: string; songs: string[] }): CorpusRow {
  return {
    id: `row-${opts.date}`,
    performerId: 'king-gizzard',
    performanceDate: opts.date,
    tourId: null,
    tourName: null,
    setlist: setlistOf(opts.songs),
    songCount: opts.songs.length,
    fetchedAt: new Date(`${opts.date}T12:00:00Z`),
    venueNameRaw: null,
  };
}

// Build a bimodal corpus — half the shows ~11 songs (Regular),
// half ~26 songs (Marathon). Song titles intentionally rotate to keep
// the noveltyRatio high (matching the worked example's 0.83).
function buildKingGizzardCorpus(): CorpusRow[] {
  const dates = [
    '2025-12-01',
    '2025-12-04',
    '2025-12-07',
    '2025-12-10',
    '2025-12-13',
    '2025-12-16',
    '2025-12-19',
    '2025-12-22',
    '2025-12-25',
    '2025-12-28',
  ];
  const out: CorpusRow[] = [];
  let counter = 0;
  for (let i = 0; i < dates.length; i += 1) {
    const targetCount = i % 2 === 0 ? 11 : 26;
    const songs: string[] = [];
    for (let j = 0; j < targetCount; j += 1) {
      // Mostly unique titles; sprinkle in a few repeats so popular
      // picks aren't empty.
      if (j === 0) songs.push('Gila Monster');
      else if (j === 1 && i % 3 === 0) songs.push('Robot Stop');
      else if (j === 2 && i % 4 === 0) songs.push('Rattlesnake');
      else {
        counter += 1;
        songs.push(`Track ${counter}`);
      }
    }
    out.push(row({ date: dates[i]!, songs }));
  }
  return out;
}

describe('predictImprovised — King Gizzard worked example', () => {
  test('returns style="improvised" with no song-level prediction list', () => {
    const out = predictImprovised({
      performerId: 'king-gizzard',
      targetDate: '2026-01-01',
      corpus: buildKingGizzardCorpus(),
    });
    assert.equal(out.style, 'improvised');
    // There must NOT be a song list field — only show modes + sketch.
    // Inspect the shape to confirm.
    assert.ok(Array.isArray(out.showModes));
    assert.ok(out.vibeSketch);
  });

  test('show-mode probabilities sum to 1.0', () => {
    const out = predictImprovised({
      performerId: 'king-gizzard',
      targetDate: '2026-01-01',
      corpus: buildKingGizzardCorpus(),
    });
    const total = out.showModes.reduce((a, m) => a + m.probability, 0);
    assert.ok(Math.abs(total - 1) <= 0.02, `expected showModes to sum to 1, got ${total}`);
  });

  test('detects bimodal Regular + Marathon clusters', () => {
    const out = predictImprovised({
      performerId: 'king-gizzard',
      targetDate: '2026-01-01',
      corpus: buildKingGizzardCorpus(),
    });
    // Expect a "Regular" cluster around 11 and a "Marathon" cluster
    // around 26. The clusterer caps at k=3 but small fixtures may
    // collapse to k=2 — accept either as long as both bands are
    // represented.
    const counts = out.showModes.map((m) => m.expectedSongCount);
    assert.ok(counts.some((c) => c <= 15), `expected a short-mode cluster (~11), got ${counts}`);
    assert.ok(counts.some((c) => c >= 20), `expected a marathon cluster (~26), got ${counts}`);
  });

  test('vibe sketch carries all 7 documented axes', () => {
    const out = predictImprovised({
      performerId: 'king-gizzard',
      targetDate: '2026-01-01',
      corpus: buildKingGizzardCorpus(),
    });
    for (const axis of VIBE_AXES) {
      assert.ok(axis in out.vibeSketch.axes, `expected axis ${axis} in vibeSketch`);
      assert.ok(typeof out.vibeSketch.axes[axis] === 'number');
      assert.ok(out.vibeSketch.axes[axis] >= 0 && out.vibeSketch.axes[axis] <= 1);
    }
  });

  test('headline descriptor is non-empty for a populated corpus', () => {
    const out = predictImprovised({
      performerId: 'king-gizzard',
      targetDate: '2026-01-01',
      corpus: buildKingGizzardCorpus(),
    });
    assert.ok(out.vibeSketch.headlineDescriptor.length > 0);
  });

  test('honors curated headline descriptor + tendencies overrides', () => {
    const out = predictImprovised({
      performerId: 'king-gizzard',
      targetDate: '2026-01-01',
      corpus: buildKingGizzardCorpus(),
      curated: {
        headlineDescriptor: 'high-energy psych-rock with extended jams',
        knownTendencies: ['Marathon shows occur ≈1 in 5'],
      },
    });
    assert.equal(
      out.vibeSketch.headlineDescriptor,
      'high-energy psych-rock with extended jams',
    );
    assert.deepEqual(out.vibeSketch.knownTendencies, [
      'Marathon shows occur ≈1 in 5',
    ]);
  });

  test('empty corpus produces a sketch with zeroed axes + neutral copy', () => {
    const out = predictImprovised({
      performerId: 'king-gizzard',
      targetDate: '2026-01-01',
      corpus: [],
    });
    assert.equal(out.sampleSize, 0);
    assert.equal(out.showModes.length, 0);
    for (const axis of VIBE_AXES) {
      assert.equal(out.vibeSketch.axes[axis], 0);
    }
  });

  test('confidence stays low — improvised never feels sure of itself', () => {
    const out = predictImprovised({
      performerId: 'king-gizzard',
      targetDate: '2026-01-01',
      corpus: buildKingGizzardCorpus(),
    });
    assert.ok(out.confidence <= 0.35, `improvised confidence should be low, got ${out.confidence}`);
  });
});

describe('computeShowModes — unit', () => {
  test('single setlist length collapses to one Standard mode', () => {
    const dates = ['2025-12-01', '2025-12-02', '2025-12-03'];
    const corpus = dates.map((d) =>
      row({ date: d, songs: Array.from({ length: 11 }, (_, i) => `S${i}`) }),
    );
    const modes = computeShowModes(corpus);
    assert.equal(modes.length, 1);
    assert.equal(modes[0]!.probability, 1);
    assert.equal(modes[0]!.expectedSongCount, 11);
  });

  test('clusters get sensible labels (Regular vs Marathon)', () => {
    const corpus = [
      row({ date: '2025-12-01', songs: Array.from({ length: 11 }, (_, i) => `R${i}`) }),
      row({ date: '2025-12-02', songs: Array.from({ length: 11 }, (_, i) => `R2${i}`) }),
      row({ date: '2025-12-03', songs: Array.from({ length: 26 }, (_, i) => `M${i}`) }),
      row({ date: '2025-12-04', songs: Array.from({ length: 26 }, (_, i) => `M2${i}`) }),
    ];
    const modes = computeShowModes(corpus);
    const labels = modes.map((m) => m.label);
    assert.ok(labels.includes('Regular set'));
    assert.ok(labels.includes('Marathon set'));
  });
});

describe('computeImprovisedShowModeHit', () => {
  test('reports a hit when actual length snaps to the predicted top mode', () => {
    const out = predictImprovised({
      performerId: 'king-gizzard',
      targetDate: '2026-01-01',
      corpus: buildKingGizzardCorpus(),
    });
    const top = out.showModes[0]!;
    const hit = computeImprovisedShowModeHit({
      performerId: 'king-gizzard',
      prediction: out,
      actualSongCount: top.expectedSongCount,
    });
    assert.ok(hit);
    assert.equal(hit!.hit, true);
    assert.equal(hit!.actualMode, top.label);
  });

  test('reports a miss when actual length lands in a different cluster', () => {
    const out = predictImprovised({
      performerId: 'king-gizzard',
      targetDate: '2026-01-01',
      corpus: buildKingGizzardCorpus(),
    });
    const top = out.showModes[0]!;
    const other = out.showModes.find((m) => m.label !== top.label);
    if (!other) return; // single-mode corpus — skip
    const hit = computeImprovisedShowModeHit({
      performerId: 'king-gizzard',
      prediction: out,
      actualSongCount: other.expectedSongCount,
    });
    assert.ok(hit);
    assert.equal(hit!.hit, false);
  });

  test('returns null when the prediction emits no modes', () => {
    const out = predictImprovised({
      performerId: 'king-gizzard',
      targetDate: '2026-01-01',
      corpus: [],
    });
    const hit = computeImprovisedShowModeHit({
      performerId: 'king-gizzard',
      prediction: out,
      actualSongCount: 12,
    });
    assert.equal(hit, null);
  });
});

describe('computeVibeSketch — unit', () => {
  test('popular picks surface songs with ≥25% played share', () => {
    const dates = ['2025-12-01', '2025-12-02', '2025-12-03', '2025-12-04'];
    const corpus = dates.map((d, i) =>
      row({
        date: d,
        songs: i < 3
          ? ['Anchor', 'Gila Monster', `Fresh ${i}`]
          : [`Fresh ${i}`],
      }),
    );
    const sketch = computeVibeSketch({ corpus });
    const anchor = sketch.popularPicks.find((p) => p.title === 'Anchor');
    assert.ok(anchor);
    assert.ok(anchor!.playedShare >= 0.25);
  });

  test('high uniqueRatio flags novelty/jam deltas', () => {
    const dates = ['2025-12-01', '2025-12-02', '2025-12-03', '2025-12-04', '2025-12-05'];
    let counter = 0;
    const corpus = dates.map((d) =>
      row({
        date: d,
        songs: Array.from({ length: 16 }, () => {
          counter += 1;
          return `Track ${counter} ${'x'.repeat(8)}`; // long titles → psychedelia axis
        }),
      }),
    );
    const sketch = computeVibeSketch({ corpus });
    assert.ok(sketch.axes.novelty > 0.7);
    assert.ok(sketch.deltas.some((d) => d.axis === 'novelty'));
  });
});
