/**
 * Pure metric helpers for the Phase 4 prediction eval harness.
 *
 * Each function takes a predicted distribution + an actual setlist and
 * returns a score. The harness in `@showbook/jobs/prediction-eval` glues
 * these to the back-test corpus walk; the admin page reads the persisted
 * outputs. All helpers are deterministic and side-effect free so they can
 * be hand-tested against worked examples.
 *
 * Spec: specs/setlist-intelligence/phases/phase-04-eval-harness.md.
 */

export interface PredictedSongLike {
  /** Display title. Lower-cased before matching. */
  title: string;
  /** Probability the algorithm assigned, in [0, 1]. */
  probability: number;
}

export interface CalibrationBin {
  /** Inclusive lower bound, exclusive upper bound (except the last bin). */
  lower: number;
  upper: number;
  /** Count of predicted songs that landed in this bin. */
  predictions: number;
  /** Mean assigned probability across `predictions` (the "claim"). */
  meanProbability: number;
  /** Fraction of `predictions` that actually played (the "truth"). */
  empiricalRate: number;
  /** `empiricalRate - meanProbability`, signed. */
  delta: number;
}

const EPS = 1e-9;

function lowerSet(titles: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of titles) {
    const lower = t.trim().toLowerCase();
    if (lower.length > 0) out.add(lower);
  }
  return out;
}

/**
 * Brier score over the predicted song set. Each predicted song contributes
 * `(p - 1)²` if it played and `(p - 0)²` if it didn't; the score is the
 * mean across all evaluated predictions. Lower is better; 0 is perfect.
 *
 * We score every distinct song the algorithm emitted (so under-confident
 * predictions are penalised). Songs the algorithm omitted entirely don't
 * appear in the average — they're captured by precision/recall instead.
 */
export function brierScore(opts: {
  predicted: PredictedSongLike[];
  actualTitles: string[];
}): number {
  if (opts.predicted.length === 0) return 0;
  const actual = lowerSet(opts.actualTitles);
  let total = 0;
  for (const song of opts.predicted) {
    const played = actual.has(song.title.trim().toLowerCase()) ? 1 : 0;
    const diff = song.probability - played;
    total += diff * diff;
  }
  return total / opts.predicted.length;
}

/**
 * Precision@K — of the K most-likely predicted songs, how many appeared in
 * the actual setlist? Ties at the K-th probability are broken by title for
 * determinism (so unit tests reproduce). Returns 0 when `predicted` is
 * empty.
 */
export function precisionAtK(opts: {
  predicted: PredictedSongLike[];
  actualTitles: string[];
  k: number;
}): number {
  if (opts.predicted.length === 0 || opts.k <= 0) return 0;
  const actual = lowerSet(opts.actualTitles);
  const sorted = [...opts.predicted].sort((a, b) => {
    if (b.probability !== a.probability) return b.probability - a.probability;
    return a.title.localeCompare(b.title);
  });
  const top = sorted.slice(0, opts.k);
  let hits = 0;
  for (const s of top) {
    if (actual.has(s.title.trim().toLowerCase())) hits += 1;
  }
  return hits / top.length;
}

/**
 * Recall@K — of the K most-likely predicted songs, what fraction of the
 * actual setlist did they cover? "Did the songs that played appear in the
 * chart?" SI-14 rotating-style gate. Returns 0 when the actual setlist is
 * empty.
 */
export function recallAtK(opts: {
  predicted: PredictedSongLike[];
  actualTitles: string[];
  k: number;
}): number {
  const actual = lowerSet(opts.actualTitles);
  if (actual.size === 0 || opts.k <= 0) return 0;
  const sorted = [...opts.predicted].sort((a, b) => {
    if (b.probability !== a.probability) return b.probability - a.probability;
    return a.title.localeCompare(b.title);
  });
  const top = sorted.slice(0, opts.k);
  let hits = 0;
  for (const s of top) {
    if (actual.has(s.title.trim().toLowerCase())) hits += 1;
  }
  return hits / actual.size;
}

/**
 * "Recall@actual" — what fraction of the actual setlist appeared *anywhere*
 * in the prediction set, regardless of rank? Captures coverage; combine
 * with brier to detect "right songs, wrong confidences."
 */
export function recallActual(opts: {
  predicted: PredictedSongLike[];
  actualTitles: string[];
}): number {
  const actual = lowerSet(opts.actualTitles);
  if (actual.size === 0) return 0;
  const predicted = lowerSet(opts.predicted.map((s) => s.title));
  let hits = 0;
  for (const lower of actual) {
    if (predicted.has(lower)) hits += 1;
  }
  return hits / actual.size;
}

/**
 * Bin the predicted distribution into 10 deciles and compute, per bin, the
 * mean assigned probability and the empirical hit rate. A perfectly
 * calibrated model has `meanProbability ≈ empiricalRate` in every bin.
 *
 * Probabilities of exactly 1.0 land in the top bin (`upper` is inclusive
 * for the final bin only).
 */
export function calibrationBuckets(opts: {
  predicted: PredictedSongLike[];
  actualTitles: string[];
  binCount?: number;
}): CalibrationBin[] {
  const binCount = opts.binCount ?? 10;
  const actual = lowerSet(opts.actualTitles);
  const bins: { lower: number; upper: number; probs: number[]; hits: number }[] = [];
  for (let i = 0; i < binCount; i++) {
    bins.push({
      lower: i / binCount,
      upper: (i + 1) / binCount,
      probs: [],
      hits: 0,
    });
  }
  for (const song of opts.predicted) {
    const p = Math.max(0, Math.min(1, song.probability));
    let idx = Math.floor(p * binCount);
    if (idx >= binCount) idx = binCount - 1;
    const bin = bins[idx]!;
    bin.probs.push(p);
    if (actual.has(song.title.trim().toLowerCase())) bin.hits += 1;
  }
  return bins.map((b) => {
    const count = b.probs.length;
    const meanProbability =
      count === 0 ? 0 : b.probs.reduce((a, c) => a + c, 0) / count;
    const empiricalRate = count === 0 ? 0 : b.hits / count;
    return {
      lower: b.lower,
      upper: b.upper,
      predictions: count,
      meanProbability,
      empiricalRate,
      delta: empiricalRate - meanProbability,
    };
  });
}

/**
 * Maximum absolute (empirical − predicted) gap across non-empty bins.
 * 0 = every bin is perfectly calibrated; 1 = at least one bin is off by
 * the full range. The Phase-4 release gate (in Phase 5) is "≤ 0.20 in
 * every bin"; this helper returns the worst-case so the cron can record
 * it as a single number alongside the per-bin payload.
 */
export function calibrationError(bins: CalibrationBin[]): number {
  let worst = 0;
  for (const bin of bins) {
    if (bin.predictions === 0) continue;
    const gap = Math.abs(bin.delta);
    if (gap > worst) worst = gap;
  }
  return worst;
}

/**
 * Merge two distinct evaluations' per-bin counts. Used when aggregating
 * per-show calibration into a per-run curve.
 */
export function mergeCalibrationBuckets(
  a: CalibrationBin[],
  b: CalibrationBin[],
): CalibrationBin[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  if (a.length !== b.length) {
    throw new Error('mergeCalibrationBuckets requires equal bin counts');
  }
  return a.map((binA, i) => {
    const binB = b[i]!;
    const predictions = binA.predictions + binB.predictions;
    if (predictions === 0) {
      return {
        lower: binA.lower,
        upper: binA.upper,
        predictions: 0,
        meanProbability: 0,
        empiricalRate: 0,
        delta: 0,
      };
    }
    const meanProbability =
      (binA.meanProbability * binA.predictions +
        binB.meanProbability * binB.predictions) /
      predictions;
    const empiricalRate =
      (binA.empiricalRate * binA.predictions +
        binB.empiricalRate * binB.predictions) /
      predictions;
    return {
      lower: binA.lower,
      upper: binA.upper,
      predictions,
      meanProbability,
      empiricalRate,
      delta: empiricalRate - meanProbability,
    };
  });
}

/**
 * Build an empty 10-bin curve so callers (and tests) don't have to repeat
 * the bin construction.
 */
export function emptyCalibrationCurve(binCount = 10): CalibrationBin[] {
  return Array.from({ length: binCount }, (_, i) => ({
    lower: i / binCount,
    upper: (i + 1) / binCount,
    predictions: 0,
    meanProbability: 0,
    empiricalRate: 0,
    delta: 0,
  }));
}

/** Floating-point safe equality for assertions / tests. */
export function approxEq(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol + EPS;
}
