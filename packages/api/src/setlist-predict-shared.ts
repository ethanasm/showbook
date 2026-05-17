/**
 * Shared shapes + helpers used across the four style predictors
 * (stable / rotating / theatrical / improvised). Phase 11 (§15f)
 * adds a uniform `SetCountPrediction` that every style emits at
 * top level so the UI can render the same "{setCount} sets ·
 * ~{songs} songs · ~{minutes} min" strip without forking per style.
 */

import type { CorpusRow } from './setlist-predict';

/**
 * Per-show set-count + length prediction. The four style branches
 * each populate this differently:
 *   - stable: rolled up from corpus mean of `setlist.length`; setCount
 *             defaults to 1 unless a run/residency surfaces multi-set
 *             evidence.
 *   - rotating: setCount from corpus mean (Phish 2-set vs 3-set
 *               structural fingerprint); song count from corpus
 *               quartiles.
 *   - theatrical: setCount always 1 (a tour show is one act sequence);
 *                 song count from the deterministic + rotating-slot
 *                 totals.
 *   - improvised: setCount weighted across show modes; song count
 *                 weighted by mode probability.
 *
 * `null` when sampleSize is too small to estimate (< 3 corpus rows).
 */
export interface SetCountPrediction {
  /** Most likely number of sets the artist will play tonight. */
  setCount: number;
  /** 0-1 share of corpus rows that played this set count. */
  setCountConfidence: number;
  /** 25th / 50th / 75th percentile of song count across corpus. */
  expectedSongCount: { p25: number; p50: number; p75: number };
  /** Expected duration in minutes when corpus carries duration data;
   *  null when set lengths aren't recorded in the source. */
  expectedDurationMin: number | null;
}

/**
 * Roll up corpus song-count + set-count statistics into a single
 * SetCountPrediction. Used by the stable + rotating algorithms.
 * Returns null when fewer than 3 corpus rows are available.
 */
export function computeSetCount(corpus: CorpusRow[]): SetCountPrediction | null {
  const real = corpus.filter((row) => !row.isSynthetic);
  if (real.length < 3) return null;

  const songCounts: number[] = [];
  const setCounts: number[] = [];
  const durations: number[] = [];

  for (const row of real) {
    songCounts.push(row.songCount);
    const setCount = countSets(row);
    if (setCount > 0) setCounts.push(setCount);
    const duration = extractDurationMin(row);
    if (duration !== null) durations.push(duration);
  }

  const sortedSongCounts = songCounts.slice().sort((a, b) => a - b);
  const p25 = percentile(sortedSongCounts, 0.25);
  const p50 = percentile(sortedSongCounts, 0.5);
  const p75 = percentile(sortedSongCounts, 0.75);

  const setCountTallies = new Map<number, number>();
  for (const c of setCounts) {
    setCountTallies.set(c, (setCountTallies.get(c) ?? 0) + 1);
  }
  let mode = 1;
  let modeShare = 0;
  let total = 0;
  for (const c of setCountTallies.values()) total += c;
  for (const [setCount, count] of setCountTallies) {
    const share = total > 0 ? count / total : 0;
    if (share > modeShare) {
      mode = setCount;
      modeShare = share;
    }
  }

  const expectedDurationMin =
    durations.length >= 3
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;

  return {
    setCount: mode,
    setCountConfidence: modeShare > 0 ? modeShare : 1,
    expectedSongCount: { p25, p50, p75 },
    expectedDurationMin,
  };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

function countSets(row: CorpusRow): number {
  const sections = row.setlist?.sections ?? [];
  if (sections.length === 0) return 1;
  const nonEncore = sections.filter((s) => s.kind === 'set').length;
  return nonEncore > 0 ? nonEncore : 1;
}

function extractDurationMin(_row: CorpusRow): number | null {
  // PerformerSetlist (packages/shared/src/types/setlist.ts) doesn't
  // carry per-set duration today — setlist.fm exposes set times only
  // in scraped HTML, not the REST JSON we ingest. Returning null
  // makes the UI omit the "~X min" suffix for stable/rotating; we'll
  // wire this when the source provides it.
  return null;
}

/** Construct a SetCountPrediction from a single song-count value. Used
 *  by theatrical (deterministic setlist length is the source of truth). */
export function setCountFromSingleCount(songCount: number): SetCountPrediction {
  return {
    setCount: 1,
    setCountConfidence: 1,
    expectedSongCount: { p25: songCount, p50: songCount, p75: songCount },
    expectedDurationMin: null,
  };
}

/** Weighted aggregation across improvised show modes. */
export function setCountFromShowModes(
  modes: Array<{ probability: number; expectedSongCount: number }>,
): SetCountPrediction | null {
  if (modes.length === 0) return null;
  const weighted = modes.reduce(
    (acc, m) => acc + m.probability * m.expectedSongCount,
    0,
  );
  const p50 = Math.round(weighted);
  const counts = modes
    .map((m) => m.expectedSongCount)
    .slice()
    .sort((a, b) => a - b);
  return {
    setCount: 1,
    setCountConfidence: modes[0]?.probability ?? 0.5,
    expectedSongCount: {
      p25: counts[0] ?? p50,
      p50,
      p75: counts[counts.length - 1] ?? p50,
    },
    expectedDurationMin: null,
  };
}
