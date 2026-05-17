/**
 * Unit suite for the Phase 5 setlist-style classifier and the
 * three-runs-to-disagree reconcile rule.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFromSignals,
  inferStyle,
  meanPairwiseJaccard,
  reconcileStyleTransition,
  setlistSongSet,
  styleSignals,
  uniqueSongRatio,
} from '../setlist-style';
import type { CorpusRow } from '../setlist-predict';
import type { PerformerSetlist } from '@showbook/shared';

function setlistOf(titles: string[]): PerformerSetlist {
  return {
    sections: [
      {
        kind: 'set',
        songs: titles.map((t) => ({ title: t })),
      },
    ],
  };
}

function corpus(setlists: string[][]): CorpusRow[] {
  return setlists.map((titles, idx) => ({
    id: `row-${idx}`,
    performerId: 'perf-0',
    performanceDate: new Date(2026, 0, idx + 1).toISOString().slice(0, 10),
    tourId: null,
    tourName: null,
    setlist: setlistOf(titles),
    songCount: titles.length,
    fetchedAt: new Date(),
  }));
}

// ─── pure helpers ─────────────────────────────────────────────────────

describe('jaccard + uniqueRatio helpers', () => {
  test('meanPairwiseJaccard is 1 for identical setlists', () => {
    const sets = corpus([['A', 'B', 'C'], ['A', 'B', 'C'], ['A', 'B', 'C']]).map(
      (r) => setlistSongSet(r.setlist),
    );
    assert.equal(meanPairwiseJaccard(sets), 1);
  });

  test('meanPairwiseJaccard is 0 for disjoint setlists', () => {
    const sets = corpus([['A', 'B'], ['C', 'D'], ['E', 'F']]).map((r) =>
      setlistSongSet(r.setlist),
    );
    assert.equal(meanPairwiseJaccard(sets), 0);
  });

  test('uniqueSongRatio = 1 when every song is unique', () => {
    const sets = corpus([['A'], ['B'], ['C'], ['D']]).map((r) =>
      setlistSongSet(r.setlist),
    );
    assert.equal(uniqueSongRatio(sets), 1);
  });

  test('uniqueSongRatio < 1 when songs repeat', () => {
    const sets = corpus([
      ['A', 'B'],
      ['A', 'B'],
      ['A', 'B'],
    ]).map((r) => setlistSongSet(r.setlist));
    // 2 distinct / 6 slots = 0.333…
    assert.ok(Math.abs(uniqueSongRatio(sets) - 1 / 3) < 1e-9);
  });
});

// ─── classifier boundaries ────────────────────────────────────────────

describe('inferStyle — corpus fixtures', () => {
  test("stable: high jaccard + low uniqueRatio (Tate McRae-shaped)", () => {
    // 8 setlists, 95% overlap, 22 songs each
    const baseTitles = Array.from({ length: 22 }, (_, i) => `Song ${i + 1}`);
    const setlists = Array.from({ length: 8 }, (_, n) => {
      // swap one song each night to keep uniqueRatio < 0.3
      const titles = [...baseTitles];
      if (n > 0) titles[20] = `Bonus ${n}`;
      return titles;
    });
    const out = inferStyle(corpus(setlists));
    assert.equal(out.style, 'stable');
    assert.ok(out.signals.jaccard >= 0.75);
    assert.ok(out.signals.uniqueRatio < 0.3);
  });

  test('rotating: low jaccard + high uniqueRatio (Phish-shaped)', () => {
    const setlists: string[][] = [];
    let songId = 0;
    for (let n = 0; n < 8; n++) {
      const titles: string[] = [];
      // Each night plays 20 fresh songs + 4 from a small recurring pool
      for (let i = 0; i < 20; i++) titles.push(`Song ${songId++}`);
      titles.push('Anchor 1', 'Anchor 2', 'Anchor 3', 'Anchor 4');
      setlists.push(titles);
    }
    const out = inferStyle(corpus(setlists));
    assert.equal(out.style, 'rotating');
    assert.ok(out.signals.jaccard <= 0.45);
    assert.ok(out.signals.uniqueRatio > 0.5);
  });

  test('theatrical: near-100% jaccard, scripted setlist (Beyoncé-shaped)', () => {
    // 15 nights of an identical 40-cue show. uniqueRatio = 40/(15*40)
    // = 0.067 → under the 0.1 theatrical bound.
    const fixed = Array.from({ length: 40 }, (_, i) => `Cue ${i + 1}`);
    const setlists = Array.from({ length: 15 }, () => [...fixed]);
    const out = inferStyle(corpus(setlists));
    assert.equal(out.style, 'theatrical');
    assert.ok(out.signals.jaccard >= 0.95);
    assert.ok(out.signals.uniqueRatio < 0.1);
  });

  test('improvised: short medium-overlap setlists hit the meanLength<6 rule', () => {
    // 6 nights, 5 songs each, drawn from an 8-song pool so the
    // uniqueRatio is < 0.5 (rotating fails) and jaccard is in the
    // medium band (stable's ≥0.75 fails too). Pure setlistLen < 6
    // case → improvised.
    const setlists = [
      ['A', 'B', 'C', 'D', 'E'],
      ['A', 'B', 'C', 'F', 'G'],
      ['A', 'B', 'D', 'F', 'H'],
      ['B', 'C', 'D', 'G', 'H'],
      ['A', 'C', 'E', 'F', 'H'],
      ['A', 'D', 'E', 'G', 'H'],
    ];
    const out = inferStyle(corpus(setlists));
    assert.equal(out.style, 'improvised');
    assert.ok(out.signals.meanLength < 6);
  });

  test('unknown when corpus < 5 setlists', () => {
    const out = inferStyle(corpus([['A'], ['B'], ['C']]));
    assert.equal(out.style, 'unknown');
  });

  test('override always wins regardless of signals', () => {
    const out = inferStyle(corpus([['A'], ['A'], ['A'], ['A'], ['A']]), {
      override: 'rotating',
    });
    assert.equal(out.style, 'rotating');
  });

  test('seed falls back when corpus too small for auto', () => {
    const out = inferStyle(corpus([['A'], ['B'], ['C']]), {
      seed: 'rotating',
    });
    assert.equal(out.style, 'rotating');
  });
});

// ─── classifyFromSignals — edge cases ─────────────────────────────────

describe('classifyFromSignals', () => {
  test('safe default falls to stable when no rule matches', () => {
    // jaccard 0.6, uniqueRatio 0.4, meanLength 10 — no rule's boundary
    assert.equal(
      classifyFromSignals({
        jaccard: 0.6,
        uniqueRatio: 0.4,
        meanLength: 10,
        corpusSize: 8,
      }),
      'stable',
    );
  });

  test('theatrical wins over stable when jaccard ≥ 0.95', () => {
    assert.equal(
      classifyFromSignals({
        jaccard: 0.97,
        uniqueRatio: 0.05,
        meanLength: 25,
        corpusSize: 8,
      }),
      'theatrical',
    );
  });
});

// ─── three-runs-to-disagree ───────────────────────────────────────────

describe('reconcileStyleTransition — three-runs-to-disagree', () => {
  test('stored=stable, three rotating runs flips on the third', () => {
    let state = {
      stored: 'stable' as const,
      disagreementCount: 0,
    };
    const seed = 'stable';
    // Run 1: rotating — counter 1, no flip
    let v = reconcileStyleTransition({
      stored: state.stored,
      disagreementCount: state.disagreementCount,
      auto: 'rotating',
      seed,
      override: null,
    });
    assert.equal(v.flipped, false);
    assert.equal(v.nextStored, 'stable');
    assert.equal(v.nextDisagreementCount, 1);
    state = {
      stored: v.nextStored as 'stable',
      disagreementCount: v.nextDisagreementCount,
    };
    // Run 2: rotating — counter 2, no flip
    v = reconcileStyleTransition({
      stored: state.stored,
      disagreementCount: state.disagreementCount,
      auto: 'rotating',
      seed,
      override: null,
    });
    assert.equal(v.flipped, false);
    assert.equal(v.nextDisagreementCount, 2);
    state = {
      stored: v.nextStored as 'stable',
      disagreementCount: v.nextDisagreementCount,
    };
    // Run 3: rotating — flip!
    v = reconcileStyleTransition({
      stored: state.stored,
      disagreementCount: state.disagreementCount,
      auto: 'rotating',
      seed,
      override: null,
    });
    assert.equal(v.flipped, true);
    assert.equal(v.nextStored, 'rotating');
    assert.equal(v.nextDisagreementCount, 0);
    assert.equal(v.reason, 'auto_flip');
  });

  test('stable → rotating → rotating → stable does NOT flip', () => {
    // The spec scenario verbatim. After two rotating runs we get a
    // stable run; counter resets to 0 and the stored value stays.
    let stored: 'stable' | 'rotating' = 'stable';
    let counter = 0;
    for (const auto of ['rotating', 'rotating', 'stable'] as const) {
      const v = reconcileStyleTransition({
        stored,
        disagreementCount: counter,
        auto,
        seed: 'stable',
        override: null,
      });
      stored = v.nextStored as 'stable' | 'rotating';
      counter = v.nextDisagreementCount;
    }
    assert.equal(stored, 'stable');
    assert.equal(counter, 0);
  });

  test('stable → rotating → rotating → rotating DOES flip on third', () => {
    let stored: 'stable' | 'rotating' = 'stable';
    let counter = 0;
    for (const auto of ['rotating', 'rotating', 'rotating'] as const) {
      const v = reconcileStyleTransition({
        stored,
        disagreementCount: counter,
        auto,
        seed: 'stable',
        override: null,
      });
      stored = v.nextStored as 'stable' | 'rotating';
      counter = v.nextDisagreementCount;
    }
    assert.equal(stored, 'rotating');
  });

  test('override always wins, regardless of stored/auto', () => {
    const v = reconcileStyleTransition({
      stored: 'rotating',
      disagreementCount: 2,
      auto: 'stable',
      seed: 'stable',
      override: 'theatrical',
    });
    assert.equal(v.nextStored, 'theatrical');
    assert.equal(v.flipped, true);
    assert.equal(v.nextDisagreementCount, 0);
  });

  test('null stored + seed applies seed initial', () => {
    const v = reconcileStyleTransition({
      stored: null,
      disagreementCount: 0,
      auto: 'unknown',
      seed: 'rotating',
      override: null,
    });
    assert.equal(v.nextStored, 'rotating');
    assert.equal(v.reason, 'seed_initial');
    assert.equal(v.flipped, true);
  });

  test('null stored + no seed + good auto applies auto', () => {
    const v = reconcileStyleTransition({
      stored: null,
      disagreementCount: 0,
      auto: 'stable',
      seed: null,
      override: null,
    });
    assert.equal(v.nextStored, 'stable');
    assert.equal(v.reason, 'auto_apply');
  });

  test('auto=unknown keeps stored value', () => {
    const v = reconcileStyleTransition({
      stored: 'rotating',
      disagreementCount: 1,
      auto: 'unknown',
      seed: 'stable',
      override: null,
    });
    assert.equal(v.nextStored, 'rotating');
    assert.equal(v.nextDisagreementCount, 1);
    assert.equal(v.flipped, false);
  });
});

// ─── styleSignals snapshot ────────────────────────────────────────────

describe('styleSignals', () => {
  test('returns the per-corpus stats the cron logs', () => {
    const s = styleSignals(corpus([['A', 'B'], ['A', 'B'], ['A', 'B']]));
    assert.equal(s.corpusSize, 3);
    assert.equal(s.meanLength, 2);
    assert.ok(s.jaccard > 0.9);
  });
});
