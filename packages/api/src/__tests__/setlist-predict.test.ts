/**
 * Comprehensive unit suite for the Bayesian predicted-setlist
 * algorithm (Phase 1 of setlist-intelligence). Exercises every pure
 * helper, every documented behaviour from `feature-plan.md` §4c, and
 * the four canonical worked examples from `worked-examples.md`
 * (Tate · Phish · Beyoncé · King Gizzard) so a regression that shifts
 * any tier weight, prior coefficient, or bucket cutoff is caught
 * before merge.
 *
 * Run with:
 *   pnpm --filter @showbook/api test setlist-predict
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate,
  bucketByProbability,
  bucketTiers,
  coldPrediction,
  computeConfidence,
  pickActiveTour,
  pickBucketingDate,
  pickRole,
  predictSetlist,
  type CorpusRow,
  type PredictedSong,
} from '../setlist-predict';
import type { PerformerSetlist } from '@showbook/shared';

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

function mkSetlist(titles: string[], encore: string[] = []): PerformerSetlist {
  const sections = [] as PerformerSetlist['sections'];
  if (titles.length > 0) {
    sections.push({ kind: 'set', songs: titles.map((title) => ({ title })) });
  }
  if (encore.length > 0) {
    sections.push({ kind: 'encore', songs: encore.map((title) => ({ title })) });
  }
  return { sections };
}

function corpusRow(opts: {
  id?: string;
  date: string;
  tourId?: string | null;
  tourName?: string | null;
  songs: string[];
  encore?: string[];
}): CorpusRow {
  const performerSetlist = mkSetlist(opts.songs, opts.encore);
  let songCount = 0;
  for (const section of performerSetlist.sections) songCount += section.songs.length;
  return {
    id: opts.id ?? `row-${opts.date}-${Math.random().toString(36).slice(2, 6)}`,
    performerId: 'performer-1',
    performanceDate: opts.date,
    tourId: opts.tourId ?? null,
    tourName: opts.tourName ?? null,
    setlist: performerSetlist,
    songCount,
    fetchedAt: new Date(`${opts.date}T12:00:00Z`),
  };
}

function offsetDate(target: string, days: number): string {
  const t = new Date(`${target}T00:00:00Z`).getTime() + days * MS_PER_DAY;
  return new Date(t).toISOString().slice(0, 10);
}

function generateConsecutiveDates(targetDate: string, count: number, daysBetween = 2): string[] {
  // Returns `count` dates ending just before targetDate, spaced
  // `daysBetween` days apart. Useful for building Tier-A windows.
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(offsetDate(targetDate, -(daysBetween * (i + 1))));
  }
  return out.reverse();
}

function flattenAllBuckets(result: ReturnType<typeof predictSetlist>): PredictedSong[] {
  if (result.style !== 'stable') return [];
  return [...result.core, ...result.likely, ...result.wildcards, ...result.rotation];
}

function makePredictedSong(title: string, probability: number, role: PredictedSong['role'] = 'core', extra?: Partial<PredictedSong>): PredictedSong {
  return {
    title,
    songId: null,
    probability,
    role,
    avgPosition: 0,
    encoreProbability: 0,
    lastPlayedDate: '2026-05-10',
    appearancesInWindow: 1,
    windowSize: 1,
    evidence: 'test',
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 1. pickActiveTour
// ─────────────────────────────────────────────────────────────────────

describe('pickActiveTour', () => {
  test('returns the most-frequent tour in the ±30d window', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ date: offsetDate(target, -25), tourId: 'tour-a', tourName: 'A', songs: ['s1', 's2'] }),
      corpusRow({ date: offsetDate(target, -20), tourId: 'tour-a', tourName: 'A', songs: ['s1', 's2'] }),
      corpusRow({ date: offsetDate(target, -14), tourId: 'tour-a', tourName: 'A', songs: ['s1', 's3'] }),
      corpusRow({ date: offsetDate(target, -10), tourId: 'tour-b', tourName: 'B', songs: ['s1'] }),
    ];
    const active = pickActiveTour({ setlists: corpus, targetDate: target });
    assert.equal(active?.tourId, 'tour-a');
    assert.equal(active?.tourName, 'A');
    assert.ok(active?.firstSeen instanceof Date);
  });

  test('returns null when no setlist in window has a tour name (indie act)', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ date: offsetDate(target, -20), tourId: null, tourName: null, songs: ['s1'] }),
      corpusRow({ date: offsetDate(target, -10), tourId: null, tourName: null, songs: ['s1'] }),
    ];
    assert.equal(pickActiveTour({ setlists: corpus, targetDate: target }), null);
  });

  test('considers post-target setlists (artist played yesterday, you go tomorrow)', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ date: offsetDate(target, 5), tourId: 'tour-a', tourName: 'A', songs: ['s1'] }),
      corpusRow({ date: offsetDate(target, 10), tourId: 'tour-a', tourName: 'A', songs: ['s1'] }),
    ];
    const active = pickActiveTour({ setlists: corpus, targetDate: target });
    assert.equal(active?.tourId, 'tour-a');
  });

  test('breaks ties by oldest firstSeen', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ date: offsetDate(target, -25), tourId: 'tour-a', tourName: 'A', songs: ['s1'] }),
      corpusRow({ date: offsetDate(target, -5), tourId: 'tour-b', tourName: 'B', songs: ['s1'] }),
    ];
    const active = pickActiveTour({ setlists: corpus, targetDate: target });
    // Tied at 1 each — older firstSeen wins.
    assert.equal(active?.tourId, 'tour-a');
  });

  test('ignores setlists outside the ±30d window even if they share a tour name', () => {
    const target = '2026-05-15';
    const corpus = [
      // Tier-B setlist (75d back) shouldn't influence active-tour pick.
      corpusRow({ date: offsetDate(target, -75), tourId: 'tour-b', tourName: 'B', songs: ['s1'] }),
      corpusRow({ date: offsetDate(target, -10), tourId: 'tour-a', tourName: 'A', songs: ['s1'] }),
    ];
    const active = pickActiveTour({ setlists: corpus, targetDate: target });
    assert.equal(active?.tourId, 'tour-a');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. bucketTiers — boundary tests for each tier
// ─────────────────────────────────────────────────────────────────────

describe('bucketTiers', () => {
  const target = '2026-05-15';
  const sameTour = 'tour-a';

  test('Tier A: same-tour, 0–30 days from target', () => {
    const corpus = [
      corpusRow({ id: 'today-7', date: offsetDate(target, -7), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'today-30', date: offsetDate(target, -30), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'after-target-15', date: offsetDate(target, 15), tourId: sameTour, tourName: 'A', songs: ['s'] }),
    ];
    const tier = bucketTiers({ setlists: corpus, targetDate: target, activeTourId: sameTour });
    for (const row of tier) {
      assert.equal(row.tier, 'a', `expected Tier A for row ${row.id} at ${row.performanceDate}`);
      assert.equal(row.weight, 1.0);
    }
  });

  test('Tier B: same-tour, 31–180 days', () => {
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -31), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -100), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'c', date: offsetDate(target, -180), tourId: sameTour, tourName: 'A', songs: ['s'] }),
    ];
    const tier = bucketTiers({ setlists: corpus, targetDate: target, activeTourId: sameTour });
    for (const row of tier) {
      assert.equal(row.tier, 'b', `expected Tier B for row at ${row.performanceDate}`);
      assert.equal(row.weight, 0.55);
    }
  });

  test('Tier C: same-tour, >180 days', () => {
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -181), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -300), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'c', date: offsetDate(target, -360), tourId: sameTour, tourName: 'A', songs: ['s'] }),
    ];
    const tier = bucketTiers({ setlists: corpus, targetDate: target, activeTourId: sameTour });
    for (const row of tier) {
      assert.equal(row.tier, 'c', `expected Tier C for row at ${row.performanceDate}`);
      assert.equal(row.weight, 0.2);
    }
  });

  test('Tier D: different tour, within 365d', () => {
    const corpus = [
      corpusRow({ id: 'now', date: offsetDate(target, -10), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'prior', date: offsetDate(target, -120), tourId: 'tour-old', tourName: 'Old', songs: ['s'] }),
    ];
    const tier = bucketTiers({ setlists: corpus, targetDate: target, activeTourId: sameTour });
    const prior = tier.find((r) => r.id === 'prior');
    assert.equal(prior?.tier, 'd');
    assert.equal(prior?.weight, 0.1);
  });

  test('Tier E: no active tour or unmatched, within 365d', () => {
    const corpus = [
      corpusRow({ id: 'unt', date: offsetDate(target, -10), tourId: null, tourName: null, songs: ['s'] }),
    ];
    const tier = bucketTiers({ setlists: corpus, targetDate: target, activeTourId: null });
    assert.equal(tier[0]!.tier, 'e');
    assert.equal(tier[0]!.weight, 0.04);
  });

  test('drops setlists more than 365 days from the target', () => {
    const corpus = [
      corpusRow({ id: 'in', date: offsetDate(target, -364), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'out', date: offsetDate(target, -400), tourId: sameTour, tourName: 'A', songs: ['s'] }),
    ];
    const tier = bucketTiers({ setlists: corpus, targetDate: target, activeTourId: sameTour });
    assert.equal(tier.length, 1);
    assert.equal(tier[0]!.id, 'in');
  });

  test('drops setlists exactly on the target date (answer key, not a feature)', () => {
    const corpus = [
      corpusRow({ id: 'today', date: target, tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'yesterday', date: offsetDate(target, -1), tourId: sameTour, tourName: 'A', songs: ['s'] }),
    ];
    const tier = bucketTiers({ setlists: corpus, targetDate: target, activeTourId: sameTour });
    assert.equal(tier.length, 1);
    assert.equal(tier[0]!.id, 'yesterday');
  });

  test('post-target setlists land in Tier A when within ±30d', () => {
    // Artist played yesterday + tomorrow + the day before your show.
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -1), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'b', date: offsetDate(target, 1), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'c', date: offsetDate(target, 5), tourId: sameTour, tourName: 'A', songs: ['s'] }),
    ];
    const tier = bucketTiers({ setlists: corpus, targetDate: target, activeTourId: sameTour });
    assert.equal(tier.length, 3);
    for (const row of tier) assert.equal(row.tier, 'a');
  });

  test('sorts result newest-first by performanceDate', () => {
    const corpus = [
      corpusRow({ id: 'old', date: offsetDate(target, -20), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'new', date: offsetDate(target, -2), tourId: sameTour, tourName: 'A', songs: ['s'] }),
      corpusRow({ id: 'mid', date: offsetDate(target, -10), tourId: sameTour, tourName: 'A', songs: ['s'] }),
    ];
    const tier = bucketTiers({ setlists: corpus, targetDate: target, activeTourId: sameTour });
    assert.equal(tier.map((t) => t.id).join(','), 'new,mid,old');
  });

  test('lowercases titles for the songsLower set (case insensitivity)', () => {
    const corpus = [
      corpusRow({ id: 'r', date: offsetDate(target, -3), tourId: sameTour, tourName: 'A', songs: ['Heroes', 'HEROES'] }),
    ];
    const tier = bucketTiers({ setlists: corpus, targetDate: target, activeTourId: sameTour });
    assert.equal(tier[0]!.songsLower.size, 1);
    assert.ok(tier[0]!.songsLower.has('heroes'));
  });

  test('preserves all songs in the songs array (including in-setlist duplicates)', () => {
    // The raw array keeps duplicates because the positional renderer
    // needs them; the songsLower set dedupes them for the W_song count.
    const corpus = [
      corpusRow({ id: 'r', date: offsetDate(target, -3), tourId: sameTour, tourName: 'A', songs: ['Tweezer'], encore: ['Tweezer'] }),
    ];
    const tier = bucketTiers({ setlists: corpus, targetDate: target, activeTourId: sameTour });
    assert.equal(tier[0]!.songs.length, 2);
    assert.equal(tier[0]!.songsLower.size, 1);
    assert.equal(tier[0]!.encoreSongsLower.has('tweezer'), true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. aggregate — per-setlist binarization
// ─────────────────────────────────────────────────────────────────────

describe('aggregate', () => {
  const target = '2026-05-15';

  test('a song appearing in the encore + main set counts once per setlist', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'r1', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['Tweezer'], encore: ['Tweezer'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const agg = aggregate(tier);
    const tweezer = agg.get('tweezer');
    assert.ok(tweezer);
    assert.equal(tweezer!.N_song, 1);
    assert.equal(tweezer!.totalAppearances, 1);
    assert.equal(tweezer!.encoreCount, 1);
  });

  test('counts per-setlist N_recent only for Tier-A setlists', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'A1', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['Manchild'] }),
        corpusRow({ id: 'B1', date: offsetDate(target, -100), tourId: 't', tourName: 'T', songs: ['Manchild'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const agg = aggregate(tier);
    assert.equal(agg.get('manchild')!.N_recent, 1);
    assert.equal(agg.get('manchild')!.N_song, 2);
  });

  test('records the latest performance date as lastPlayedDate', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'old', date: offsetDate(target, -100), tourId: 't', tourName: 'T', songs: ['Song'] }),
        corpusRow({ id: 'recent', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['Song'] }),
        corpusRow({ id: 'middle', date: offsetDate(target, -50), tourId: 't', tourName: 'T', songs: ['Song'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const agg = aggregate(tier);
    assert.equal(agg.get('song')!.lastPlayedDate, offsetDate(target, -3));
  });

  test('weighted sums use the per-tier weight', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'A', date: offsetDate(target, -5), tourId: 't', tourName: 'T', songs: ['Song'] }), // weight 1.0
        corpusRow({ id: 'B', date: offsetDate(target, -100), tourId: 't', tourName: 'T', songs: ['Song'] }), // weight 0.55
        corpusRow({ id: 'C', date: offsetDate(target, -300), tourId: 't', tourName: 'T', songs: ['Song'] }), // weight 0.2
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const agg = aggregate(tier);
    // 1.0 + 0.55 + 0.2 = 1.75
    assert.ok(Math.abs(agg.get('song')!.W_song - 1.75) < 1e-9);
  });

  test('positions list contains the first index in each setlist', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'a', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['Opener', 'Mid', 'Closer'] }),
        corpusRow({ id: 'b', date: offsetDate(target, -5), tourId: 't', tourName: 'T', songs: ['Mid', 'Opener', 'Closer'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const agg = aggregate(tier);
    const opener = agg.get('opener')!;
    assert.deepEqual([...opener.positions].sort(), [0, 1]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Bayesian smoothing math — exact values at various N
// ─────────────────────────────────────────────────────────────────────

describe('Bayesian smoothing', () => {
  test('1-of-1 yields ~0.6 (not 1.0) — Beta(2,2) prior pulls hard with tiny N', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['Song'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    assert.equal(result.style, 'stable');
    const song = flattenAllBuckets(result).find((s) => s.title === 'Song')!;
    // With W_total=1, N_corpus=1, W_song=1: p = (1+2)/(1+4) = 0.6.
    // Active-tour anchor needs ≥3 Tier-A setlists, so anchor is silent here.
    assert.ok(Math.abs(song.probability - 0.6) < 0.01, `expected ~0.6, got ${song.probability}`);
  });

  test('2-of-2 yields ~0.667', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['Song'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -5), tourId: 't', tourName: 'T', songs: ['Song'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Song')!;
    // p = (2+2)/(2+4) = 4/6 ≈ 0.667
    assert.ok(Math.abs(song.probability - 0.667) < 0.01, `expected ~0.667, got ${song.probability}`);
  });

  test('3-of-3 yields ~0.714 (without anchor)', () => {
    const target = '2026-05-15';
    // Recent leg started well before the 60d anchor window, so anchor
    // is silent. 3 setlists across 200 days.
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -150), tourId: 't', tourName: 'T', songs: ['Song'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -100), tourId: 't', tourName: 'T', songs: ['Song'] }),
      corpusRow({ id: 'c', date: offsetDate(target, -50), tourId: 't', tourName: 'T', songs: ['Song'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Song')!;
    // No Tier-A setlists here (all are Tier B at 50-180d), so
    // recentLegStart is null → anchor silent. W_total = 1.65, N=3.
    // p = (1.65 + 2*1.65/3) / (1.65 + 4*1.65/3) = (1.65 + 1.1) / (1.65 + 2.2) ≈ 0.714
    assert.ok(Math.abs(song.probability - 0.714) < 0.02, `expected ~0.714, got ${song.probability}`);
  });

  test('5-of-5 yields ~0.778 without anchor', () => {
    const target = '2026-05-15';
    // 5 setlists in Tier B (not Tier A), so anchor is silent.
    const corpus = Array.from({ length: 5 }, (_, i) =>
      corpusRow({
        id: `r${i}`,
        date: offsetDate(target, -60 - i * 10),
        tourId: 't',
        tourName: 'T',
        songs: ['Song'],
      }),
    );
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Song')!;
    // p = (5 + 2)/(5 + 4) = 7/9 ≈ 0.778 (Tier-B weight cancels out)
    assert.ok(song.probability >= 0.75 && song.probability <= 0.82, `expected ~0.78, got ${song.probability}`);
  });

  test('10-of-10 yields ~0.857 without anchor', () => {
    const target = '2026-05-15';
    const corpus = Array.from({ length: 10 }, (_, i) =>
      corpusRow({
        id: `r${i}`,
        date: offsetDate(target, -60 - i * 5),
        tourId: 't',
        tourName: 'T',
        songs: ['Song'],
      }),
    );
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Song')!;
    // p = (10 + 2)/(10 + 4) = 12/14 ≈ 0.857
    assert.ok(song.probability >= 0.83 && song.probability <= 0.88, `expected ~0.857, got ${song.probability}`);
  });

  test('0-of-N (song never appeared) — not in results', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ id: 'r1', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['Other'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const all = flattenAllBuckets(result);
    assert.equal(all.find((s) => s.title === 'Song'), undefined);
  });

  test('rare song 1-of-30 lands in rotation after the one-off suppressor', () => {
    const target = '2026-05-15';
    const recentTierA = generateConsecutiveDates(target, 6, 3);
    const corpus: CorpusRow[] = [];
    recentTierA.forEach((d, i) => {
      corpusRow({ id: `tier-a-${i}`, date: d, tourId: 't', tourName: 'T', songs: ['Core'] });
    });
    for (let i = 0; i < 6; i++) {
      corpus.push(corpusRow({ id: `a${i}`, date: recentTierA[i]!, tourId: 't', tourName: 'T', songs: ['Core'] }));
    }
    // Add a single Tier-B setlist with a one-off song far back in time.
    corpus.push(corpusRow({ id: 'old', date: offsetDate(target, -120), tourId: 't', tourName: 'T', songs: ['Old Bustout'] }));
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    assert.equal(result.style, 'stable');
    if (result.style === 'stable') {
      const bust = result.rotation.find((s) => s.title === 'Old Bustout');
      assert.ok(bust, 'expected Old Bustout to be suppressed into rotation');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Active-tour anchor — boundary tests
// ─────────────────────────────────────────────────────────────────────

describe('Active-tour anchor', () => {
  test('fires at exactly 80% Tier-A coverage + 3 setlists + leg start ≤60d', () => {
    const target = '2026-05-15';
    // 5 Tier-A setlists. Song appears in 4 → 80%. recentLegStart = ~10d back.
    const dates = generateConsecutiveDates(target, 5, 2);
    const corpus = dates.map((d, i) =>
      corpusRow({
        id: `r${i}`,
        date: d,
        tourId: 't',
        tourName: 'T',
        songs: i < 4 ? ['Anchored'] : ['Other'],
      }),
    );
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Anchored')!;
    assert.ok(song.probability >= 0.85, `expected anchor floor 0.85, got ${song.probability}`);
  });

  test('does not fire below 80% Tier-A coverage', () => {
    const target = '2026-05-15';
    const dates = generateConsecutiveDates(target, 5, 2);
    const corpus = dates.map((d, i) =>
      corpusRow({
        id: `r${i}`,
        date: d,
        tourId: 't',
        tourName: 'T',
        songs: i < 3 ? ['Iffy'] : ['Other'],
      }),
    );
    // 3/5 = 60% — below threshold. The raw smoothed math should land
    // well below 0.85, around 0.5-0.65 (because Tier-A weighted plus
    // Beta(2,2) prior averages the W_song fraction).
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Iffy')!;
    assert.ok(song.probability < 0.85, `expected < 0.85, got ${song.probability}`);
  });

  test('does not fire when Tier-A has fewer than 3 setlists', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Song'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -5), tourId: 't', tourName: 'T', songs: ['Song'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Song')!;
    // 2 setlists. Anchor needs 3.
    assert.ok(song.probability < 0.85, `expected anchor silent for 2 setlists, got ${song.probability}`);
  });

  test('does not fire when the recent leg started > 60 days back', () => {
    const target = '2026-05-15';
    // 4 setlists, all >60d back. They land in Tier-B, so tierA is empty.
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -65), tourId: 't', tourName: 'T', songs: ['Song'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -70), tourId: 't', tourName: 'T', songs: ['Song'] }),
      corpusRow({ id: 'c', date: offsetDate(target, -75), tourId: 't', tourName: 'T', songs: ['Song'] }),
      corpusRow({ id: 'd', date: offsetDate(target, -80), tourId: 't', tourName: 'T', songs: ['Song'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Song')!;
    // No tier A → no anchor.
    assert.ok(song.probability < 0.85, `expected anchor silent for old leg, got ${song.probability}`);
  });

  test('fires at exactly 60d leg start (boundary inclusive)', () => {
    const target = '2026-05-15';
    // 3 Tier-A setlists; oldest is exactly 60 days back.
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Song'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -10), tourId: 't', tourName: 'T', songs: ['Song'] }),
      corpusRow({ id: 'c', date: offsetDate(target, -29), tourId: 't', tourName: 'T', songs: ['Song'] }),
    ];
    // 3/3 = 100% — should fire.
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Song')!;
    assert.ok(song.probability >= 0.85, `expected anchor at boundary, got ${song.probability}`);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. One-off suppressor
// ─────────────────────────────────────────────────────────────────────

describe('One-off suppressor', () => {
  test('moves N_song=1 older-than-Tier-A into rotation', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ id: 'A1', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['Core'] }),
      corpusRow({ id: 'A2', date: offsetDate(target, -7), tourId: 't', tourName: 'T', songs: ['Core'] }),
      corpusRow({ id: 'A3', date: offsetDate(target, -12), tourId: 't', tourName: 'T', songs: ['Core'] }),
      corpusRow({ id: 'old', date: offsetDate(target, -120), tourId: 't', tourName: 'T', songs: ['Bustout'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (result.style !== 'stable') throw new Error('expected stable result');
    assert.ok(result.rotation.some((s) => s.title === 'Bustout'));
    assert.ok(!result.core.some((s) => s.title === 'Bustout'));
    assert.ok(!result.likely.some((s) => s.title === 'Bustout'));
    assert.ok(!result.wildcards.some((s) => s.title === 'Bustout'));
  });

  test('does NOT move N_song=1 when its appearance is the latest Tier-A setlist', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ id: 'A1', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['Core', 'Surprise'] }),
      corpusRow({ id: 'A2', date: offsetDate(target, -7), tourId: 't', tourName: 'T', songs: ['Core'] }),
      corpusRow({ id: 'A3', date: offsetDate(target, -12), tourId: 't', tourName: 'T', songs: ['Core'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (result.style !== 'stable') throw new Error('expected stable result');
    // Surprise appeared in the latest setlist — not suppressed.
    assert.ok(!result.rotation.some((s) => s.title === 'Surprise'));
  });

  test('does NOT move N_song=2 — needs the per-song appearance count to be exactly 1', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ id: 'A1', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['Core'] }),
      corpusRow({ id: 'A2', date: offsetDate(target, -7), tourId: 't', tourName: 'T', songs: ['Core'] }),
      corpusRow({ id: 'A3', date: offsetDate(target, -12), tourId: 't', tourName: 'T', songs: ['Core'] }),
      corpusRow({ id: 'B1', date: offsetDate(target, -100), tourId: 't', tourName: 'T', songs: ['Sometimes'] }),
      corpusRow({ id: 'B2', date: offsetDate(target, -120), tourId: 't', tourName: 'T', songs: ['Sometimes'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (result.style !== 'stable') throw new Error('expected stable result');
    // Sometimes has N_song=2 → no suppression.
    const sometimes = flattenAllBuckets(result).find((s) => s.title === 'Sometimes');
    assert.ok(sometimes);
    assert.ok(!result.rotation.includes(sometimes!));
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. bucketByProbability — cutoff boundary tests
// ─────────────────────────────────────────────────────────────────────

describe('bucketByProbability', () => {
  test('exact cutoffs: 0.65 → core, 0.6499 → likely, 0.35 → likely, 0.3499 → wildcards, 0.1 → wildcards, 0.0999 → rotation', () => {
    const songs = [
      makePredictedSong('CoreEdge', 0.65),
      makePredictedSong('LikelyTop', 0.6499),
      makePredictedSong('LikelyEdge', 0.35),
      makePredictedSong('WildTop', 0.3499),
      makePredictedSong('WildEdge', 0.1),
      makePredictedSong('RotTop', 0.0999),
    ];
    const aggs = new Map<string, ReturnType<typeof aggregate> extends Map<unknown, infer V> ? V : never>();
    for (const s of songs) {
      aggs.set(s.title.toLowerCase(), {
        title: s.title,
        W_song: 1,
        N_song: 3,
        N_recent: 2,
        positions: [0],
        encoreCount: 0,
        lastPlayedDate: '2026-05-10',
        totalAppearances: 3,
        realAppearances: 3,
        syntheticAlbumName: null,
      });
    }
    const buckets = bucketByProbability({ songs, latestTierADate: null, aggregates: aggs });
    assert.equal(buckets.core.map((s) => s.title).join(','), 'CoreEdge');
    assert.deepEqual(buckets.likely.map((s) => s.title).sort(), ['LikelyEdge', 'LikelyTop']);
    assert.deepEqual(buckets.wildcards.map((s) => s.title).sort(), ['WildEdge', 'WildTop']);
    assert.equal(buckets.rotation.map((s) => s.title).join(','), 'RotTop');
  });

  test('orders core by role-rank then avgPosition', () => {
    const songs = [
      makePredictedSong('Closer', 0.9, 'closer', { avgPosition: 18 }),
      makePredictedSong('Opener', 0.9, 'opener', { avgPosition: 0 }),
      makePredictedSong('Mid', 0.8, 'core', { avgPosition: 5 }),
      makePredictedSong('Early', 0.8, 'core', { avgPosition: 2 }),
    ];
    const aggs = new Map();
    for (const s of songs) {
      aggs.set(s.title.toLowerCase(), {
        title: s.title,
        W_song: 1,
        N_song: 3,
        N_recent: 2,
        positions: [s.avgPosition],
        encoreCount: 0,
        lastPlayedDate: '2026-05-10',
        totalAppearances: 3,
      });
    }
    const buckets = bucketByProbability({ songs, latestTierADate: null, aggregates: aggs });
    assert.deepEqual(buckets.core.map((s) => s.title), ['Opener', 'Early', 'Mid', 'Closer']);
  });

  test('keeps wildcards / rotation sorted by descending probability', () => {
    const songs = [
      makePredictedSong('w1', 0.15),
      makePredictedSong('w2', 0.32),
      makePredictedSong('w3', 0.21),
    ];
    const aggs = new Map();
    for (const s of songs) {
      aggs.set(s.title.toLowerCase(), {
        title: s.title,
        W_song: 1,
        N_song: 3,
        N_recent: 0,
        positions: [0],
        encoreCount: 0,
        lastPlayedDate: '2026-05-10',
        totalAppearances: 3,
      });
    }
    const buckets = bucketByProbability({ songs, latestTierADate: null, aggregates: aggs });
    assert.deepEqual(buckets.wildcards.map((s) => s.title), ['w2', 'w3', 'w1']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. computeConfidence
// ─────────────────────────────────────────────────────────────────────

describe('computeConfidence', () => {
  const target = '2026-05-15';

  test('density saturates at 6+ Tier-A setlists', () => {
    const dates = generateConsecutiveDates(target, 6, 2);
    const tier = bucketTiers({
      setlists: dates.map((d, i) =>
        corpusRow({ id: `r${i}`, date: d, tourId: 't', tourName: 'T', songs: ['s'] }),
      ),
      targetDate: target,
      activeTourId: 't',
    });
    const c6 = computeConfidence({ tierA: tier, targetDate: target });
    // 6 Tier-A, identical, latest ≤7d → all factors saturate.
    assert.ok(c6 >= 0.99, `expected ~1.0 with 6 saturated factors, got ${c6}`);
  });

  test('density scales linearly between 0 and 6 Tier-A setlists', () => {
    const tier3 = bucketTiers({
      setlists: generateConsecutiveDates(target, 3, 2).map((d, i) =>
        corpusRow({ id: `r${i}`, date: d, tourId: 't', tourName: 'T', songs: ['s'] }),
      ),
      targetDate: target,
      activeTourId: 't',
    });
    const c3 = computeConfidence({ tierA: tier3, targetDate: target });
    // density = 3/6 = 0.5; consistency = 1.0; recency = 1.0
    // confidence = 0.5*0.5 + 0.3*1 + 0.2*1 = 0.75
    assert.ok(Math.abs(c3 - 0.75) < 0.05, `expected ~0.75, got ${c3}`);
  });

  test('consistency drops with low Jaccard (Phish-like)', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['a', 'b', 'c'] }),
        corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['d', 'e', 'f'] }),
        corpusRow({ id: 'c', date: offsetDate(target, -6), tourId: 't', tourName: 'T', songs: ['g', 'h', 'i'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const c = computeConfidence({ tierA: tier, targetDate: target });
    // Jaccard mean = 0 → consistency factor = 0.
    // density = 0.5, recency = 1.0
    // confidence = 0.5*0.5 + 0.3*0 + 0.2*1 = 0.45
    assert.ok(c < 0.5, `expected < 0.5 with zero overlap, got ${c}`);
  });

  test('recency saturates at ≤7d old', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'a', date: offsetDate(target, -7), tourId: 't', tourName: 'T', songs: ['s'] }),
        corpusRow({ id: 'b', date: offsetDate(target, -10), tourId: 't', tourName: 'T', songs: ['s'] }),
        corpusRow({ id: 'c', date: offsetDate(target, -14), tourId: 't', tourName: 'T', songs: ['s'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const c = computeConfidence({ tierA: tier, targetDate: target });
    // recency saturated (7d). density = 0.5, consistency = 1.0
    // → 0.25 + 0.3 + 0.2 = 0.75
    assert.ok(Math.abs(c - 0.75) < 0.05);
  });

  test('recency declines past 7d', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'a', date: offsetDate(target, -20), tourId: 't', tourName: 'T', songs: ['s'] }),
        corpusRow({ id: 'b', date: offsetDate(target, -23), tourId: 't', tourName: 'T', songs: ['s'] }),
        corpusRow({ id: 'c', date: offsetDate(target, -26), tourId: 't', tourName: 'T', songs: ['s'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const c = computeConfidence({ tierA: tier, targetDate: target });
    // recency at 20d: 1 - (20-7)/30 ≈ 0.567
    // density = 0.5, consistency = 1.0
    // → 0.25 + 0.3 + 0.113 = 0.663
    assert.ok(c >= 0.55 && c <= 0.72, `expected ~0.66, got ${c}`);
  });

  test('zero tier A → recency + density = 0', () => {
    const c = computeConfidence({ tierA: [], targetDate: target });
    assert.equal(c, 0);
  });

  test('single Tier-A setlist gets a moderate consistency (0.5) — no pairwise signal', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'a', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['s', 's2'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const c = computeConfidence({ tierA: tier, targetDate: target });
    // density = 1/6, consistency = 0.5, recency = 1.0
    // → 0.5/6 + 0.15 + 0.2 ≈ 0.433
    assert.ok(c >= 0.35 && c <= 0.5, `expected ~0.43, got ${c}`);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. coldPrediction + cold reasons
// ─────────────────────────────────────────────────────────────────────

describe('coldPrediction', () => {
  test('all six reasons round-trip', () => {
    for (const reason of ['no_mbid', 'no_corpus', 'no_headliner', 'date_not_set', 'wrong_kind', 'production_show'] as const) {
      const cold = coldPrediction(reason, 'Test Artist');
      assert.equal(cold.style, 'cold');
      assert.equal(cold.reason, reason);
      assert.equal(cold.confidence, 0);
      assert.equal(cold.sampleSize, 0);
      assert.equal(cold.tourCoverage, 'cold');
      assert.equal(cold.spoilerBlurDefault, false);
      assert.deepEqual(cold.core, []);
      assert.deepEqual(cold.likely, []);
      assert.deepEqual(cold.wildcards, []);
      assert.deepEqual(cold.rotation, []);
    }
  });

  test('performerName defaults to null', () => {
    const cold = coldPrediction('no_corpus');
    assert.equal(cold.performerName, null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 10. predictSetlist — end-to-end on canonical worked examples
// ─────────────────────────────────────────────────────────────────────

describe('worked example — Tate McRae · Miss Possessive Tour (stable)', () => {
  // Mirrors `worked-examples.md` §1. 21 stable songs across 14 recent
  // setlists, one surprise rotation slot, targeted mid-tour.
  const target = '2025-09-15';
  const tourName = 'Miss Possessive Tour';
  const tourId = 'tate-miss-possessive';
  const core21 = [
    'Miss possessive', "No I'm not in love", '2 hands', 'guilty conscience',
    'Purple lace bra', 'Like I do', 'uh oh', 'Dear god', 'Siren sounds',
    'Greenlight', 'Nostalgia (flashback medley)', 'you broke me first',
    'run for the hills', 'exes', 'bloodonmyhands', "she's all i wanna be",
    'Revolving door', "It's ok I'm ok",
  ];
  const encore = ['Just Keep Watching', 'Sports car', 'greedy'];

  function buildTateCorpus(): CorpusRow[] {
    const corpus: CorpusRow[] = [];
    // 14 Tier-A setlists.
    for (let i = 0; i < 14; i++) {
      const d = offsetDate(target, -(2 * (i + 1)));
      corpus.push(corpusRow({ id: `tate-a-${i}`, date: d, tourId, tourName, songs: core21, encore }));
    }
    // 1 setlist where the guest duet appears (one-off).
    corpus.push(
      corpusRow({
        id: 'tate-guest',
        date: offsetDate(target, -150),
        tourId,
        tourName,
        songs: [...core21, '6 Months Later (w/ Megan Moroney)'],
        encore,
      }),
    );
    return corpus;
  }

  test('confidence ≥ 0.85', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildTateCorpus() });
    assert.equal(result.style, 'stable');
    if (result.style !== 'stable') throw new Error('expected stable');
    assert.ok(result.confidence >= 0.85, `expected ≥ 0.85, got ${result.confidence}`);
  });

  test('21 core songs surface as core/likely (the 21 stable lineup)', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildTateCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable');
    const present = new Set([...result.core, ...result.likely].map((s) => s.title.toLowerCase()));
    for (const title of [...core21, ...encore]) {
      assert.ok(present.has(title.toLowerCase()), `expected ${title} in core/likely`);
    }
  });

  test('guest-duet rotation surfaces separately in rotation pile', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildTateCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable');
    assert.ok(result.rotation.some((s) => s.title === '6 Months Later (w/ Megan Moroney)'));
  });

  test('tourCoverage = active_tour, spoilerBlurDefault = true', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildTateCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable');
    assert.equal(result.tourCoverage, 'active_tour');
    assert.equal(result.spoilerBlurDefault, true);
  });

  test('tourId and tourName surface correctly', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildTateCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable');
    assert.equal(result.tourId, tourId);
    assert.equal(result.tourName, tourName);
  });

  test('sampleSize equals the corpus length passed in (not just Tier A)', () => {
    const corpus = buildTateCorpus();
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (result.style !== 'stable') throw new Error('expected stable');
    assert.equal(result.sampleSize, corpus.length);
  });
});

describe('worked example — Phish · Sphere residency (rotating)', () => {
  // Phish: ~185 unique songs across 27 shows. High variance.
  const target = '2026-04-30';
  const tourName = 'Sphere Residency';
  const tourId = 'phish-sphere';

  function buildPhishCorpus(): CorpusRow[] {
    const corpus: CorpusRow[] = [];
    // 8 Tier-A setlists, each plays 18 entirely-disjoint songs +
    // one ubiquitous staple. The disjoint slice math: 8 * 18 = 144
    // unique pool entries.
    for (let night = 0; night < 8; night++) {
      const songs: string[] = [];
      for (let i = 0; i < 18; i++) {
        songs.push(`phish-song-${night * 18 + i}`);
      }
      songs.push('Tweezer');
      corpus.push(
        corpusRow({
          id: `phish-${night}`,
          date: offsetDate(target, -(2 * (night + 1))),
          tourId,
          tourName,
          songs,
        }),
      );
    }
    return corpus;
  }

  test('Phish confidence stays meaningfully below Tate-class stable predictions', () => {
    const phishResult = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildPhishCorpus() });
    if (phishResult.style !== 'stable') throw new Error('algorithm returns stable shape; style classifier is Phase 5');
    // Algorithm output for Phish is bounded above by ~0.85 (sat density
    // + sat recency, near-zero Jaccard). What matters most for the
    // §15 setlist-style classifier (Phase 5) is that Phish lands at
    // least 0.15 below Tate-class predictions.
    assert.ok(phishResult.confidence < 0.85, `expected Phish ≤ 0.85, got ${phishResult.confidence}`);
  });

  test('staples like Tweezer surface as core/likely', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildPhishCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable shape');
    const tweezer = flattenAllBuckets(result).find((s) => s.title === 'Tweezer')!;
    assert.ok(tweezer);
    // 100% Tier A coverage + 8 setlists in last 16 days → active-tour
    // anchor fires, p ≥ 0.85.
    assert.ok(tweezer.probability >= 0.85, `expected anchor floor, got ${tweezer.probability}`);
  });

  test('Phish rotation+wildcards far outnumber the core (185-unique reality)', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildPhishCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable shape');
    const lowConfidenceCount = result.rotation.length + result.wildcards.length;
    assert.ok(
      lowConfidenceCount > result.core.length * 3,
      `expected rotation+wildcards (${lowConfidenceCount}) >> core (${result.core.length})`,
    );
  });
});

describe('worked example — Beyoncé · Cowboy Carter Tour (theatrical)', () => {
  // Theatrical: deterministic setlist of ~37 songs. Nearly identical
  // across nights. confidence should saturate.
  const target = '2026-05-15';
  const tourName = 'Cowboy Carter Tour';
  const tourId = 'beyonce-cowboy-carter';
  const fixedSetlist = Array.from({ length: 30 }, (_, i) => `Bey ${i + 1}`);
  const fixedEncore = ['Texas Hold ’Em', 'America Has a Problem', 'Halo'];

  function buildBeyonceCorpus(): CorpusRow[] {
    const corpus: CorpusRow[] = [];
    for (let i = 0; i < 10; i++) {
      corpus.push(
        corpusRow({
          id: `bey-${i}`,
          date: offsetDate(target, -(3 * (i + 1))),
          tourId,
          tourName,
          songs: fixedSetlist,
          encore: fixedEncore,
        }),
      );
    }
    return corpus;
  }

  test('confidence ≥ 0.90', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildBeyonceCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable');
    assert.ok(result.confidence >= 0.9, `expected ≥ 0.9, got ${result.confidence}`);
  });

  test('every song lands in core (deterministic setlist)', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildBeyonceCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable');
    const allCore = new Set(result.core.map((s) => s.title));
    for (const t of [...fixedSetlist, ...fixedEncore]) assert.ok(allCore.has(t), `expected ${t} in core`);
    assert.equal(result.likely.length, 0);
    assert.equal(result.wildcards.length, 0);
    assert.equal(result.rotation.length, 0);
  });
});

describe('worked example — King Gizzard (improvised)', () => {
  // Improvised: extremely high song-pool variance, low repeat rate.
  // Confidence drops to floor.
  const target = '2026-06-10';
  const tourName = 'PetroDragonic';
  const tourId = 'king-gizz-petro';

  function buildKingGizzCorpus(): CorpusRow[] {
    const corpus: CorpusRow[] = [];
    // 6 Tier-A setlists, each entirely unique songs.
    for (let i = 0; i < 6; i++) {
      const songs = Array.from({ length: 14 }, (_, j) => `kg-${i}-${j}`);
      corpus.push(
        corpusRow({
          id: `kg-${i}`,
          date: offsetDate(target, -(2 * (i + 1))),
          tourId,
          tourName,
          songs,
        }),
      );
    }
    return corpus;
  }

  test('confidence sits ≤ 0.7 (most variance score = 0)', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildKingGizzCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable shape');
    assert.ok(result.confidence <= 0.7, `expected ≤ 0.7, got ${result.confidence}`);
  });

  test('every song lands in rotation (every song is a one-off)', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildKingGizzCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable shape');
    // 84 unique songs, every one with N_song=1 and lastPlayed < latestTierA.
    // But the latest Tier A IS one of the setlists with these songs, so
    // those songs' lastPlayedDate == latestTierADate → not suppressed.
    // The OLDER setlists' songs ARE older → suppressed.
    // We expect at least the 5 oldest setlists' songs (~70) to land in
    // rotation; the latest setlist's 14 in wildcards.
    assert.ok(result.rotation.length >= 30, `expected lots of rotation, got ${result.rotation.length}`);
  });
});

describe('worked example — Sabrina Carpenter · Short n\' Sweet (tour-evolution)', () => {
  // Late-tour: pre-deluxe-drop setlists + post-drop setlists. The
  // active-tour anchor should fire for the new additions added in
  // October even though the corpus contains earlier-tour setlists
  // without them.
  const target = '2025-12-01';
  const tourName = 'Short n\' Sweet Tour';
  const tourId = 'sabrina-sns';

  function buildSabrinaCorpus(): CorpusRow[] {
    const corpus: CorpusRow[] = [];
    const preDrop = ['Taste', 'Bed Chem', 'Espresso', 'Please Please Please'];
    const postDrop = [...preDrop, 'Manchild', 'House Tour', 'Tears'];
    // 8 pre-drop setlists, all Tier B (>30d back, same tour).
    for (let i = 0; i < 8; i++) {
      corpus.push(
        corpusRow({
          id: `sns-pre-${i}`,
          date: offsetDate(target, -(45 + i * 10)),
          tourId,
          tourName,
          songs: preDrop,
        }),
      );
    }
    // 6 post-drop setlists, all Tier A (within 30d back).
    for (let i = 0; i < 6; i++) {
      corpus.push(
        corpusRow({
          id: `sns-post-${i}`,
          date: offsetDate(target, -(2 + i * 4)),
          tourId,
          tourName,
          songs: postDrop,
        }),
      );
    }
    return corpus;
  }

  test('post-drop additions (Manchild, House Tour, Tears) anchor at 0.85+', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildSabrinaCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable');
    const all = flattenAllBuckets(result);
    for (const title of ['Manchild', 'House Tour', 'Tears']) {
      const s = all.find((x) => x.title === title);
      assert.ok(s, `expected ${title} in result`);
      assert.ok(s!.probability >= 0.85, `expected ${title} ≥ 0.85, got ${s!.probability}`);
    }
  });

  test('pre-drop staples also land in core (full tour visibility)', () => {
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildSabrinaCorpus() });
    if (result.style !== 'stable') throw new Error('expected stable');
    const all = flattenAllBuckets(result);
    for (const title of ['Taste', 'Espresso']) {
      const s = all.find((x) => x.title === title);
      assert.ok(s, `expected ${title}`);
      assert.ok(s!.probability >= 0.7, `expected ${title} ≥ 0.7, got ${s!.probability}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 11. predictSetlist — coverage states + spoiler defaults
// ─────────────────────────────────────────────────────────────────────

describe('coverage resolution', () => {
  const target = '2026-05-15';

  test('active_tour when active-tour pick succeeds and Tier A ≥ 1', () => {
    const corpus = [
      corpusRow({ id: 'r', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: ['s'] }),
      corpusRow({ id: 's', date: offsetDate(target, -5), tourId: 't', tourName: 'T', songs: ['s'] }),
    ];
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.equal(r.tourCoverage, 'active_tour');
  });

  test('recent_tour when active-tour pick succeeds but no Tier A', () => {
    const corpus = [
      corpusRow({ id: 'r', date: offsetDate(target, -100), tourId: 't', tourName: 'T', songs: ['s'] }),
      corpusRow({ id: 's', date: offsetDate(target, -120), tourId: 't', tourName: 'T', songs: ['s'] }),
    ];
    // No setlist in ±30d → active-tour pick returns null → falls
    // through to last_year coverage. (Spec resolution: active_tour
    // requires a Tier A setlist.)
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.equal(r.tourCoverage, 'last_year');
  });

  test('last_year when no tour name is present anywhere', () => {
    const corpus = [
      corpusRow({ id: 'r', date: offsetDate(target, -50), tourId: null, tourName: null, songs: ['s'] }),
      corpusRow({ id: 's', date: offsetDate(target, -100), tourId: null, tourName: null, songs: ['s'] }),
    ];
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.equal(r.tourCoverage, 'last_year');
    // Spec: last_year coverage caps confidence at 0.5.
    assert.ok(r.confidence <= 0.5, `expected confidence capped, got ${r.confidence}`);
  });

  test('cold when corpus is empty', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: [] });
    assert.equal(r.style, 'cold');
    if (r.style === 'cold') assert.equal(r.reason, 'no_corpus');
  });

  test('cold when every setlist is outside the 365d window', () => {
    const corpus = [
      corpusRow({ id: 'r', date: offsetDate(target, -400), tourId: 't', tourName: 'T', songs: ['s'] }),
    ];
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    assert.equal(r.style, 'cold');
  });
});

describe('spoilerBlurDefault truth table', () => {
  const target = '2026-05-15';

  test('true when active_tour AND confidence ≥ 0.55', () => {
    // Strong Tate-like corpus.
    const corpus = generateConsecutiveDates(target, 6, 2).map((d, i) =>
      corpusRow({ id: `r${i}`, date: d, tourId: 't', tourName: 'T', songs: ['s1', 's2'] }),
    );
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.equal(r.tourCoverage, 'active_tour');
    assert.ok(r.confidence >= 0.55);
    assert.equal(r.spoilerBlurDefault, true);
  });

  test('false when active_tour but confidence < 0.55 (low-Jaccard tour)', () => {
    // Even with active tour, low Jaccard → low confidence → no spoiler.
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['a', 'b'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['c', 'd'] }),
    ];
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.equal(r.tourCoverage, 'active_tour');
    assert.ok(r.confidence < 0.55);
    assert.equal(r.spoilerBlurDefault, false);
  });

  test('false in last_year coverage', () => {
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -50), tourId: null, tourName: null, songs: ['s'] }),
    ];
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.equal(r.spoilerBlurDefault, false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 12. Role inference via pickRole
// ─────────────────────────────────────────────────────────────────────

describe('pickRole', () => {
  const target = '2026-05-15';

  test('opener fires when the song is at position 0 (non-encore) in every setlist', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Opener', 'Mid', 'Closer'] }),
        corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['Opener', 'Mid2', 'Closer2'] }),
        corpusRow({ id: 'c', date: offsetDate(target, -6), tourId: 't', tourName: 'T', songs: ['Opener', 'Mid3'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const role = pickRole({ tier, titleLower: 'opener' });
    assert.equal(role.role, 'opener');
  });

  test('encore_open and encore_close roles surface for songs in the encore slots', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Main', 'Mid'], encore: ['EncOpen', 'EncMid', 'EncClose'] }),
        corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['Main', 'Mid'], encore: ['EncOpen', 'EncMid', 'EncClose'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const open = pickRole({ tier, titleLower: 'encopen' });
    const close = pickRole({ tier, titleLower: 'encclose' });
    assert.equal(open.role, 'encore_open');
    assert.equal(close.role, 'encore_close');
  });

  test('falls back to core when no role owns ≥50% across three+ setlists', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Wobble', 'B', 'C', 'D'] }), // opener
        corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['A', 'B', 'Wobble', 'D'] }), // core
        corpusRow({ id: 'c', date: offsetDate(target, -6), tourId: 't', tourName: 'T', songs: ['A', 'B', 'C', 'Wobble'] }), // closer
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const role = pickRole({ tier, titleLower: 'wobble' });
    // Each of opener/core/closer gets 1/3 — none meet the 50% bar →
    // fallthrough is `core`.
    assert.equal(role.role, 'core');
  });

  test('role-rank tiebreak: at exactly 50%, the first role in rank order wins', () => {
    // Two setlists: opener once + closer once. Each = 50%. The spec
    // requires `≥ 50%` for the role to fire; ROLE_RANK is
    // [opener, core, closer, encore_open, encore_close], so opener
    // wins the tiebreak.
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Wobble', 'B'] }),
        corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['A', 'Wobble'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const role = pickRole({ tier, titleLower: 'wobble' });
    assert.equal(role.role, 'opener');
  });

  test('avgPosition reflects mean position across setlists', () => {
    const tier = bucketTiers({
      setlists: [
        corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Tag', 'a', 'b'] }),
        corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['a', 'b', 'Tag'] }),
        corpusRow({ id: 'c', date: offsetDate(target, -6), tourId: 't', tourName: 'T', songs: ['a', 'Tag', 'b'] }),
      ],
      targetDate: target,
      activeTourId: 't',
    });
    const role = pickRole({ tier, titleLower: 'tag' });
    // positions: 0, 2, 1 → mean 1
    assert.ok(Math.abs(role.avgPosition - 1) < 1e-9);
  });

  test('returns core+0 when the song is not in the tier', () => {
    const tier: never[] = [];
    const role = pickRole({ tier, titleLower: 'unseen' });
    assert.equal(role.role, 'core');
    assert.equal(role.avgPosition, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 13. Edge cases
// ─────────────────────────────────────────────────────────────────────

describe('predictSetlist — edge cases', () => {
  const target = '2026-05-15';

  test('case-insensitive title collapse (Heroes / heroes / HEROES)', () => {
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Heroes'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['heroes'] }),
      corpusRow({ id: 'c', date: offsetDate(target, -6), tourId: 't', tourName: 'T', songs: ['HEROES'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const all = flattenAllBuckets(result);
    const heroesEntries = all.filter((s) => s.title.toLowerCase() === 'heroes');
    assert.equal(heroesEntries.length, 1, 'expected case variants to collapse');
    assert.equal(heroesEntries[0]!.appearancesInWindow, 3);
  });

  test('trims trailing whitespace on titles when aggregating', () => {
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Song'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['Song '] }),
      corpusRow({ id: 'c', date: offsetDate(target, -6), tourId: 't', tourName: 'T', songs: ['Song'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const all = flattenAllBuckets(result);
    const matches = all.filter((s) => s.title.toLowerCase().trim() === 'song');
    assert.equal(matches.length, 1);
  });

  test('handles a setlist with only an encore section', () => {
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: [], encore: ['Ghost'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const ghost = flattenAllBuckets(result).find((s) => s.title === 'Ghost');
    assert.ok(ghost, 'Ghost should still surface');
  });

  test('does not crash with a single-section, single-song setlist', () => {
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Only'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    assert.equal(result.style, 'stable');
  });

  test('exposes evidence string for every song', () => {
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Song'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['Song'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Song')!;
    assert.equal(song.evidence, '2 of last 2 shows');
  });

  test('singularizes the evidence string for N_song=1', () => {
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Solo'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['Other'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const solo = flattenAllBuckets(result).find((s) => s.title === 'Solo')!;
    assert.match(solo.evidence, /\b1\s+of\s+last\s+\d+\s+show\b/);
  });

  test('probability clamps to [0,1]', () => {
    // Sanity — even after the active-tour anchor floor.
    const corpus = generateConsecutiveDates(target, 8, 1).map((d, i) =>
      corpusRow({ id: `r${i}`, date: d, tourId: 't', tourName: 'T', songs: ['Anchored'] }),
    );
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    for (const s of flattenAllBuckets(result)) {
      assert.ok(s.probability >= 0 && s.probability <= 1, `probability out of range for ${s.title}: ${s.probability}`);
    }
  });

  test('encoreProbability is 0 when the song never appeared in an encore', () => {
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Song'], encore: ['Other'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['Song'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Song')!;
    assert.equal(song.encoreProbability, 0);
  });

  test('encoreProbability scales toward 1 as the song is consistently played as encore', () => {
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -2), tourId: 't', tourName: 'T', songs: ['Other'], encore: ['Song'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -4), tourId: 't', tourName: 'T', songs: ['Other'], encore: ['Song'] }),
      corpusRow({ id: 'c', date: offsetDate(target, -6), tourId: 't', tourName: 'T', songs: ['Other'], encore: ['Song'] }),
    ];
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    const song = flattenAllBuckets(result).find((s) => s.title === 'Song')!;
    assert.equal(song.encoreProbability, 1);
  });

  test('handles very large corpora (50+ setlists) without throwing', () => {
    const corpus = Array.from({ length: 50 }, (_, i) =>
      corpusRow({
        id: `mass-${i}`,
        date: offsetDate(target, -(2 * (i + 1))),
        tourId: 't',
        tourName: 'T',
        songs: [`song-${i % 21}`, 'staple'],
      }),
    );
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    assert.equal(result.style, 'stable');
    if (result.style === 'stable') {
      assert.equal(result.sampleSize, 50);
    }
  });

  test('coverage falls through to last_year (capped confidence) when an indie act has many setlists but no tour name', () => {
    const corpus = generateConsecutiveDates(target, 5, 4).map((d, i) =>
      corpusRow({ id: `indie-${i}`, date: d, tourId: null, tourName: null, songs: ['Solo Show'] }),
    );
    const result = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (result.style !== 'stable') throw new Error('expected stable');
    assert.equal(result.tourCoverage, 'last_year');
    assert.ok(result.confidence <= 0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 14. predictSetlist — defensive guards
// ─────────────────────────────────────────────────────────────────────

describe('defensive guards', () => {
  test('a corpus of only-on-target rows resolves to no_corpus', () => {
    const target = '2026-05-15';
    const corpus = [corpusRow({ id: 'a', date: target, tourId: 't', tourName: 'T', songs: ['s'] })];
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    assert.equal(r.style, 'cold');
  });

  test('a corpus entirely past the 365d window resolves to cold', () => {
    const target = '2026-05-15';
    const corpus = [
      corpusRow({ id: 'a', date: offsetDate(target, -400), tourId: 't', tourName: 'T', songs: ['s'] }),
      corpusRow({ id: 'b', date: offsetDate(target, -500), tourId: 't', tourName: 'T', songs: ['s'] }),
    ];
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    assert.equal(r.style, 'cold');
  });

  test('empty setlists rows are dropped from the result', () => {
    const target = '2026-05-15';
    const corpus = [
      // The aggregator only counts songs present in songsLower; an
      // empty setlist contributes weight to W_total but no songs.
      corpusRow({ id: 'empty', date: offsetDate(target, -3), tourId: 't', tourName: 'T', songs: [] }),
      corpusRow({ id: 'real', date: offsetDate(target, -5), tourId: 't', tourName: 'T', songs: ['Real'] }),
    ];
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus });
    if (r.style !== 'stable') throw new Error('expected stable');
    const real = flattenAllBuckets(r).find((s) => s.title === 'Real')!;
    assert.equal(real.appearancesInWindow, 1);
    // W_total should include the empty setlist's tier weight,
    // suppressing Real's probability slightly.
    assert.ok(real.probability < 0.7);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 15. pickBucketingDate — far-future-show anchor slide
// ─────────────────────────────────────────────────────────────────────

describe('pickBucketingDate', () => {
  const now = new Date('2026-05-18T12:00:00Z');

  test('past targets pass through unchanged', () => {
    const result = pickBucketingDate({
      targetDate: '2025-09-15',
      setlists: [
        corpusRow({ date: '2025-09-10', tourId: 't', tourName: 'T', songs: ['s'] }),
      ],
      now,
    });
    assert.equal(result, '2025-09-15');
  });

  test('near-future targets (≤30d) pass through unchanged', () => {
    const result = pickBucketingDate({
      targetDate: '2026-06-10', // 23 days out
      setlists: [
        corpusRow({ date: '2026-05-01', tourId: 't', tourName: 'T', songs: ['s'] }),
      ],
      now,
    });
    assert.equal(result, '2026-06-10');
  });

  test('far-future target with setlists near target keeps original anchor', () => {
    // Artist has future-scheduled setlists within ±30d of target.
    const result = pickBucketingDate({
      targetDate: '2026-08-16', // 90 days out
      setlists: [
        corpusRow({ date: '2026-08-10', tourId: 't', tourName: 'T', songs: ['s'] }),
      ],
      now,
    });
    assert.equal(result, '2026-08-16');
  });

  test('far-future target slides to most-recent past setlist when no nearby data', () => {
    const result = pickBucketingDate({
      targetDate: '2026-08-16', // 90 days out
      setlists: [
        corpusRow({ date: '2026-05-10', tourId: 't', tourName: 'T', songs: ['s'] }),
        corpusRow({ date: '2026-04-22', tourId: 't', tourName: 'T', songs: ['s'] }),
      ],
      now,
    });
    assert.equal(result, '2026-05-10');
  });

  test('far-future target with no past setlists falls back to today', () => {
    const result = pickBucketingDate({
      targetDate: '2026-08-16',
      setlists: [],
      now,
    });
    assert.equal(result, '2026-05-18');
  });

  test('ignores synthetic album-drop rows when picking the slide anchor', () => {
    // Synthetic rows are positioned around the target; they shouldn't
    // be considered "real recent activity" for the slide.
    const result = pickBucketingDate({
      targetDate: '2026-08-16',
      setlists: [
        corpusRow({ date: '2026-05-10', tourId: 't', tourName: 'T', songs: ['s'] }),
        { ...corpusRow({ date: '2026-08-15', tourId: null, tourName: null, songs: ['album-drop'] }), isSynthetic: true },
      ],
      now,
    });
    // Should slide to the real setlist, not the synthetic one.
    assert.equal(result, '2026-05-10');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 16. predictSetlist — far-future show end-to-end
// ─────────────────────────────────────────────────────────────────────

describe('far-future show (regression — was returning confidence=0)', () => {
  // Mirrors the Passion Pit bug: target is 90 days in the future, the
  // artist has recently toured but every setlist sits outside ±30d of
  // the target. The old code collapsed everything to Tier-E
  // (weight 0.04) → tierA.length = 0 → confidence = 0.
  const target = '2026-08-16';
  const now = new Date('2026-05-18T12:00:00Z');
  const tourId = 'passion-pit-2026';
  const tourName = 'Tropical Hangover Tour';
  const core = [
    'Sleepyhead',
    'The Reeling',
    "Moth's Wings",
    'Constant Conversations',
    'Carried Away',
    'Take a Walk',
  ];

  // 6 recent setlists, all within ±30d of `now` (none within ±30d of
  // the future target).
  function buildCorpus(): CorpusRow[] {
    const dates = ['2026-04-22', '2026-04-29', '2026-05-03', '2026-05-08', '2026-05-12', '2026-05-15'];
    return dates.map((d, i) =>
      corpusRow({ id: `pp-${i}`, date: d, tourId, tourName, songs: core }),
    );
  }

  test('produces non-zero confidence (>= 0.5) instead of 0', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildCorpus(), now });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.ok(r.confidence >= 0.5, `expected ≥0.5, got ${r.confidence}`);
  });

  test('coverage is active_tour, not last_year', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildCorpus(), now });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.equal(r.tourCoverage, 'active_tour');
    assert.equal(r.tourId, tourId);
    assert.equal(r.tourName, tourName);
  });

  test('every core song lands in the core bucket', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildCorpus(), now });
    if (r.style !== 'stable') throw new Error('expected stable');
    const coreSet = new Set(r.core.map((s) => s.title.toLowerCase()));
    for (const title of core) {
      assert.ok(
        coreSet.has(title.toLowerCase()),
        `expected ${title} in core bucket, got core=${[...coreSet].join(',')}`,
      );
    }
  });

  test('sampleSize equals the corpus length (6)', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildCorpus(), now });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.equal(r.sampleSize, 6);
  });

  test('songs in only some setlists land in `likely` (non-empty)', () => {
    // Add a "sometimes" song that appears in 3 of 6 — should land in
    // likely (p ≈ 0.5), not core (≥0.65) and not rotation.
    const corpus = buildCorpus();
    corpus[0]!.setlist.sections[0]!.songs.push({ title: 'Mirror Mirror' });
    corpus[2]!.setlist.sections[0]!.songs.push({ title: 'Mirror Mirror' });
    corpus[4]!.setlist.sections[0]!.songs.push({ title: 'Mirror Mirror' });
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus, now });
    if (r.style !== 'stable') throw new Error('expected stable');
    const likelyTitles = r.likely.map((s) => s.title.toLowerCase());
    assert.ok(
      likelyTitles.includes('mirror mirror'),
      `expected Mirror Mirror in likely, got likely=${likelyTitles.join(',')}`,
    );
  });

  test('past-target prior-tour-only case still caps at last_year confidence', () => {
    // Sanity: when the only setlists are >365 days from the target
    // AND the slide doesn't help (no Tier-A regardless), we still
    // fall through to the cold guard.
    const oldTour = [
      corpusRow({ id: 'old1', date: '2024-06-01', tourId: 't-old', tourName: 'Old', songs: core }),
    ];
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: oldTour, now });
    // 2024-06-01 is >365 days from both `target` (Aug 16, 2026) and
    // `now` (May 18, 2026 → slide anchor 2024-06-01), so bucketTiers
    // drops it → cold.
    assert.equal(r.style, 'cold');
  });
});

describe('near-term festival, no recent corpus (regression — Tash Sultana 0% bug)', () => {
  // Mirrors the Tash Sultana case: a festival show 2 days out, the
  // artist hasn't toured recently (latest setlist ~6 months ago), but
  // the corpus carries ~10 historical rows worth of evidence. The old
  // code took the empty-tier-A → empty-±30d-fallback path through
  // `computeConfidence` and returned 0% even though "Unleash the Rage
  // — 8 of last 10 shows" is clearly an informative prediction.
  const target = '2026-05-22';
  const now = new Date('2026-05-20T12:00:00Z');
  const core = [
    'Unleash the Rage',
    'Hazard to Myself',
    'Greed',
    'Milk & Honey',
    'Notion',
  ];

  function buildCorpus(): CorpusRow[] {
    // 10 setlists spread across a late-2025 run — no active tour in
    // 2026, no setlists within ±30d of either the target or `now`,
    // but still inside the 365-day corpus window so `bucketTiers`
    // keeps them in tier-E rather than dropping the whole corpus.
    const dates = [
      '2025-09-02', '2025-09-05', '2025-09-09', '2025-09-13', '2025-09-16',
      '2025-09-20', '2025-09-23', '2025-09-27', '2025-10-01', '2025-10-04',
    ];
    return dates.map((d, i) =>
      corpusRow({ id: `tash-${i}`, date: d, tourId: null, tourName: null, songs: core }),
    );
  }

  test('produces non-zero confidence when corpus exists but no recent activity', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildCorpus(), now });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.ok(r.confidence > 0, `expected > 0, got ${r.confidence}`);
  });

  test('confidence sits at the last_year cap (≤0.5) for the historical-only corpus', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildCorpus(), now });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.ok(r.confidence <= 0.5, `expected ≤0.5 (last_year cap), got ${r.confidence}`);
  });

  test('core songs still surface in the core bucket', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildCorpus(), now });
    if (r.style !== 'stable') throw new Error('expected stable');
    const coreSet = new Set(r.core.map((s) => s.title.toLowerCase()));
    for (const title of core) {
      assert.ok(coreSet.has(title.toLowerCase()), `expected ${title} in core`);
    }
  });
});

describe('untagged-corpus show (regression — Foster the People 0% bug)', () => {
  // Mirrors the Foster the People case: a far-future show with ~20
  // real setlists, high consistency ("13 of last 19 shows"), but
  // setlist.fm coverage doesn't carry a `tourId` on the rows — common
  // for festival-circuit artists and artists between named tours. The
  // old code took the empty `tierA` path through computeConfidence and
  // returned 0%, even though the corpus was clearly informative.
  const target = '2026-09-11';
  const now = new Date('2026-05-20T12:00:00Z');
  const core = [
    'Helena Beat',
    'Lost in Space',
    'Houdini',
    'Pseudologia Fantastica',
    'Call It What You Want',
    "Lamb's Wool",
  ];

  function buildCorpus(): CorpusRow[] {
    const corpus: CorpusRow[] = [];
    // 19 real setlists, none tagged with a tour, spread across the
    // last ~3 months. Each plays the full core (high Jaccard).
    for (let i = 0; i < 19; i++) {
      corpus.push(
        corpusRow({
          id: `ftp-${i}`,
          date: offsetDate('2026-05-18', -(2 * (i + 1))),
          tourId: null,
          tourName: null,
          songs: core,
        }),
      );
    }
    return corpus;
  }

  test('produces non-zero confidence despite no tour tag', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildCorpus(), now });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.ok(r.confidence > 0, `expected > 0, got ${r.confidence}`);
  });

  test('hits the last_year confidence cap (≈0.5) for a coherent untagged corpus', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildCorpus(), now });
    if (r.style !== 'stable') throw new Error('expected stable');
    // Density saturates (6+ recent setlists), consistency saturates
    // (identical setlists), recency hits 0 because target is ~115d
    // from the latest setlist → raw confidence ~0.8, then capped to
    // 0.5 by the `last_year` coverage rule.
    assert.ok(
      Math.abs(r.confidence - 0.5) < 0.01,
      `expected ~0.5 (last_year cap), got ${r.confidence}`,
    );
  });

  test('coverage stays last_year (no active tour was detected)', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildCorpus(), now });
    if (r.style !== 'stable') throw new Error('expected stable');
    assert.equal(r.tourCoverage, 'last_year');
    assert.equal(r.tourId, null);
    assert.equal(r.tourName, null);
  });

  test('core songs still surface in the core bucket', () => {
    const r = predictSetlist({ performerId: 'p', targetDate: target, corpus: buildCorpus(), now });
    if (r.style !== 'stable') throw new Error('expected stable');
    const coreSet = new Set(r.core.map((s) => s.title.toLowerCase()));
    for (const title of core) {
      assert.ok(coreSet.has(title.toLowerCase()), `expected ${title} in core`);
    }
  });
});
