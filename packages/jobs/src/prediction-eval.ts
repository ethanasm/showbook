/**
 * Daily back-test eval harness for the §4c predicted-setlist algorithm.
 *
 * For every (performer, performance_date) in the trailing window, the
 * harness reconstructs the corpus *as it would have looked* the day before
 * — `performance_date < target_date` — and re-runs `predictSetlist`
 * against the truncated view. The resulting prediction is compared to the
 * actual songs played in that setlist, and per-show + per-run metrics are
 * persisted to `prediction_eval_runs` / `prediction_eval_shows`.
 *
 * Shadow mode through Phase 4 — the numbers land in the DB and the
 * `/admin/eval` page, but no automated gate yet. Phase 5 will turn this
 * into the release gate (Brier ≤ 0.15 stable, recall-at-15 ≥ 0.55
 * rotating, calibration error ≤ 20pp).
 *
 * Per-show evaluation helpers live in `@showbook/api/eval-show` so the
 * tRPC `eval.rerunShow` mutation can call them without a circular
 * import; this module owns the corpus walk and the persistence shape.
 *
 * Spec: specs/setlist-intelligence/phases/phase-04-eval-harness.md
 */

import { and, asc, gte, inArray, lte } from 'drizzle-orm';
import {
  db,
  performers,
  predictionEvalRuns,
  predictionEvalShows,
  tourSetlists,
} from '@showbook/db';
import { child } from '@showbook/observability';
import {
  calibrationBuckets,
  calibrationError,
  emptyCalibrationCurve,
  evaluateShow,
  flattenPrediction,
  inferStyleForEval,
  loadTruncatedCorpus,
  mergeCalibrationBuckets,
  predictImprovised,
  predictSetlist,
  predictTheatrical,
  recallAtK,
  setlistTitles,
  type CalibrationBin,
  type EvalStyle,
  type PerShowEvalRow,
  type PredictedSongLike,
  type SetlistStyleOrUnknown,
} from '@showbook/api';
import type { PerformerSetlist } from '@showbook/shared';

const log = child({ component: 'jobs.prediction-eval' });

const MS_PER_DAY = 86_400_000;

/** Style buckets the harness aggregates over. Phase 1 only emits `stable`. */
const STYLES: EvalStyle[] = ['stable', 'rotating', 'theatrical', 'improvised'];

export interface RunDailyBacktestInput {
  /** Trailing window in days. Defaults to 14 per the Phase-4 brief. */
  windowDays?: number;
  /** Today, as a YYYY-MM-DD string. Injectable for tests. */
  today?: string;
}

export interface PerStyleSummary {
  style: EvalStyle;
  predictions: number;
  brier: number;
  precisionTop10: number;
  recallActual: number;
  recallTop15: number;
  calibrationError: number;
  /**
   * Phase 6 — improvised only. Empirical hit-rate of the predicted
   * top show-mode minus its predicted probability over the trailing
   * window. The setlist release-gate consumes this value to decide
   * whether the improvised display variant is allowed to flip ON.
   * Null for non-improvised styles.
   */
  showModeCalibrationDelta?: number | null;
}

export interface RunDailyBacktestResult {
  runId: string | null;
  windowDays: number;
  evaluatedShows: number;
  predictionCount: number;
  brierScore: number;
  precisionTop10: number;
  recallTop10: number;
  recallTop15: number;
  calibrationError: number;
  byStyle: PerStyleSummary[];
}

export type { PerShowEvalRow, EvalStyle } from '@showbook/api';
export { rerunEvalForShow, evaluateShow, inferStyleForEval } from '@showbook/api';

/**
 * Phase 6 — flatten a theatrical prediction into the song-list shape
 * the brier/recall scorers consume. Deterministic songs all carry
 * p=1.0; rotating-slot candidates each carry their probability. The
 * combined list is what we score the actual setlist against.
 */
function flattenTheatrical(prediction: {
  deterministicSetlist: Array<{ title: string; probability: number }>;
  rotatingSlots: Array<{
    candidates: Array<{ title: string; probability: number }>;
  }>;
}): PredictedSongLike[] {
  const out: PredictedSongLike[] = [];
  const seen = new Set<string>();
  for (const song of prediction.deterministicSetlist) {
    const lower = song.title.trim().toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push({ title: song.title, probability: song.probability });
  }
  for (const slot of prediction.rotatingSlots) {
    for (const candidate of slot.candidates) {
      const lower = candidate.title.trim().toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push({ title: candidate.title, probability: candidate.probability });
    }
  }
  return out;
}

/**
 * Phase 6 — pick the closest show-mode for an actual setlist length.
 * Returns the matching mode (smallest |actualLength - expectedCount|)
 * or null when the modes array is empty.
 */
function isClosestMode(opts: {
  actualLength: number;
  modes: Array<{ label: string; expectedSongCount: number }>;
}): { label: string } | null {
  if (opts.modes.length === 0) return null;
  let best = opts.modes[0]!;
  let bestDist = Math.abs(opts.actualLength - best.expectedSongCount);
  for (const mode of opts.modes.slice(1)) {
    const d = Math.abs(opts.actualLength - mode.expectedSongCount);
    if (d < bestDist) {
      best = mode;
      bestDist = d;
    }
  }
  return { label: best.label };
}

/** Pure helper — aggregate per-show rows into a per-run summary. Exported
 * for unit tests. */
export function summarizeRun(
  rows: PerShowEvalRow[],
  curve: CalibrationBin[],
): {
  predictionCount: number;
  brierScore: number;
  precisionTop10: number;
  recallTop10: number;
  recallTop15: number;
  calibrationError: number;
  byStyle: PerStyleSummary[];
} {
  if (rows.length === 0) {
    return {
      predictionCount: 0,
      brierScore: 0,
      precisionTop10: 0,
      recallTop10: 0,
      recallTop15: 0,
      calibrationError: 0,
      byStyle: [],
    };
  }

  let predictionCount = 0;
  let brierAcc = 0;
  let p10Acc = 0;
  let r15Acc = 0;
  let r10Acc = 0;
  for (const r of rows) {
    predictionCount += r.predicted.length;
    brierAcc += r.brier;
    p10Acc += r.precisionTop10;
    r15Acc += r.recallTop15;
    r10Acc += recallAtK({
      predicted: r.predicted.map((s) => ({
        title: s.title,
        probability: s.probability,
      })),
      actualTitles: r.actual,
      k: 10,
    });
  }
  const n = rows.length;

  const byStyleMap = new Map<EvalStyle, PerShowEvalRow[]>();
  for (const r of rows) {
    const list = byStyleMap.get(r.style) ?? [];
    list.push(r);
    byStyleMap.set(r.style, list);
  }
  const byStyle: PerStyleSummary[] = [];
  for (const style of STYLES) {
    const list = byStyleMap.get(style);
    if (!list || list.length === 0) continue;
    let bs = 0;
    let p10 = 0;
    let rA = 0;
    let r15 = 0;
    let curveStyle: CalibrationBin[] = emptyCalibrationCurve(curve.length);
    let preds = 0;
    for (const row of list) {
      bs += row.brier;
      p10 += row.precisionTop10;
      rA += row.recallActual;
      r15 += row.recallTop15;
      preds += row.predicted.length;
      curveStyle = mergeCalibrationBuckets(
        curveStyle,
        calibrationBuckets({
          predicted: row.predicted.map((s) => ({
            title: s.title,
            probability: s.probability,
          })),
          actualTitles: row.actual,
          binCount: curve.length,
        }),
      );
    }
    byStyle.push({
      style,
      predictions: preds,
      brier: bs / list.length,
      precisionTop10: p10 / list.length,
      recallActual: rA / list.length,
      recallTop15: r15 / list.length,
      calibrationError: calibrationError(curveStyle),
    });
  }

  return {
    predictionCount,
    brierScore: brierAcc / n,
    precisionTop10: p10Acc / n,
    recallTop10: r10Acc / n,
    recallTop15: r15Acc / n,
    calibrationError: calibrationError(curve),
    byStyle,
  };
}

/**
 * Walk the recent corpus and evaluate every (performer, date) pair. The
 * SI-04 no-MBID short-circuit and the cold-prediction skips are handled
 * inside `predictSetlist` — we just drop any cold results since the eval
 * has nothing to score.
 */
export async function runDailyBacktest(
  input: RunDailyBacktestInput = {},
): Promise<RunDailyBacktestResult> {
  const windowDays = input.windowDays ?? 14;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const earliest = new Date(new Date(today).getTime() - windowDays * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

  log.info(
    {
      event: 'eval.run.started',
      windowDays,
      today,
      earliest,
    },
    'Daily prediction-eval back-test started',
  );

  try {
    const setlistsInWindow = await db
      .select({
        id: tourSetlists.id,
        performerId: tourSetlists.performerId,
        performanceDate: tourSetlists.performanceDate,
        setlist: tourSetlists.setlist,
      })
      .from(tourSetlists)
      .where(
        and(
          gte(tourSetlists.performanceDate, earliest),
          lte(tourSetlists.performanceDate, today),
        ),
      )
      .orderBy(asc(tourSetlists.performanceDate));

    if (setlistsInWindow.length === 0) {
      log.info(
        {
          event: 'eval.run.complete',
          windowDays,
          evaluatedShows: 0,
          predictionCount: 0,
        },
        'No setlists in window — back-test recorded as empty run',
      );
      return {
        runId: null,
        windowDays,
        evaluatedShows: 0,
        predictionCount: 0,
        brierScore: 0,
        precisionTop10: 0,
        recallTop10: 0,
        recallTop15: 0,
        calibrationError: 0,
        byStyle: [],
      };
    }

    const performerIds = Array.from(new Set(setlistsInWindow.map((s) => s.performerId)));
    const performerRows = performerIds.length
      ? await db
          .select({
            id: performers.id,
            name: performers.name,
            setlistStyle: performers.setlistStyle,
            setlistStyleOverride: performers.setlistStyleOverride,
          })
          .from(performers)
          .where(inArray(performers.id, performerIds))
      : [];
    const performerName = new Map(performerRows.map((p) => [p.id, p.name]));
    const performerStyle = new Map(
      performerRows.map((p) => [
        p.id,
        {
          stored: (p.setlistStyle ?? null) as SetlistStyleOrUnknown | null,
          override: (p.setlistStyleOverride ?? null) as SetlistStyleOrUnknown | null,
        },
      ]),
    );

    const rows: PerShowEvalRow[] = [];
    let curve = emptyCalibrationCurve(10);
    // Phase 6 — track per-show improvised observations so the post-run
    // summary can compute the show-mode calibration delta. Each entry
    // captures the top-mode probability the model predicted and
    // whether the actual show landed in that same mode.
    const improvisedObs: Array<{ topModeProb: number; hit: boolean }> = [];

    for (const tsRow of setlistsInWindow) {
      const corpus = await loadTruncatedCorpus({
        performerId: tsRow.performerId,
        targetDate: tsRow.performanceDate,
      });
      const actualTitles = setlistTitles(tsRow.setlist as PerformerSetlist);
      if (actualTitles.length === 0) continue;

      const styleHints = performerStyle.get(tsRow.performerId);
      const bucketStyle = inferStyleForEval({
        corpus,
        override: styleHints?.override ?? null,
        seed: styleHints?.stored ?? null,
      });

      let flat: PredictedSongLike[] | null = null;
      let sampleSize = corpus.length;
      let didScoreSongs = true;

      if (bucketStyle === 'stable') {
        const prediction = predictSetlist({
          performerId: tsRow.performerId,
          targetDate: tsRow.performanceDate,
          corpus,
        });
        if (prediction.style !== 'stable') continue;
        flat = flattenPrediction(prediction);
        sampleSize = prediction.sampleSize;
      } else if (bucketStyle === 'theatrical') {
        const prediction = predictTheatrical({
          performerId: tsRow.performerId,
          targetDate: tsRow.performanceDate,
          corpus,
        });
        flat = flattenTheatrical(prediction);
        sampleSize = prediction.sampleSize;
      } else if (bucketStyle === 'improvised') {
        // Improvised model emits no song-level prediction — track the
        // show-mode hit so the post-run aggregation can produce a
        // calibration delta for the release gate. Skip the song-level
        // brier/recall computation.
        const prediction = predictImprovised({
          performerId: tsRow.performerId,
          targetDate: tsRow.performanceDate,
          corpus,
        });
        if (prediction.showModes.length > 0) {
          const topMode = prediction.showModes[0]!;
          // The actual show's mode is derived by re-running the
          // clusterer with the actual length appended (so we map the
          // historical truth into the same label space). Cheap because
          // the clusterer is O(N·iter) over a tiny window.
          const actualLength = actualTitles.length;
          const hit = isClosestMode({
            actualLength,
            modes: prediction.showModes,
          })?.label === topMode.label;
          improvisedObs.push({ topModeProb: topMode.probability, hit });
        }
        didScoreSongs = false;
      } else if (bucketStyle === 'rotating') {
        // Rotating is the Phase 5 path — there's no scored gap-chart
        // mode yet (recall-at-15 is the primary metric, and the
        // rotating prediction doesn't emit per-song probabilities the
        // brier scorer can consume directly). Phase 5 left this branch
        // skipped; carry that forward.
        continue;
      }

      if (didScoreSongs && flat) {
        const row = evaluateShow({
          tourSetlistId: tsRow.id,
          performerId: tsRow.performerId,
          performerName: performerName.get(tsRow.performerId) ?? 'Unknown',
          performanceDate: tsRow.performanceDate,
          predicted: flat,
          sampleSize,
          actualTitles,
          style: bucketStyle,
        });
        rows.push(row);
        curve = mergeCalibrationBuckets(
          curve,
          calibrationBuckets({
            predicted: flat,
            actualTitles,
            binCount: 10,
          }),
        );
      }
    }

    const summary = summarizeRun(rows, curve);
    // Phase 6 — splice the improvised show-mode delta into the
    // matching summary entry (or append a fresh one when no improvised
    // song-level prediction surfaced — the calibration metric stands
    // on its own).
    if (improvisedObs.length > 0) {
      const meanTopProb =
        improvisedObs.reduce((a, o) => a + o.topModeProb, 0) /
        improvisedObs.length;
      const empirical =
        improvisedObs.reduce((a, o) => a + (o.hit ? 1 : 0), 0) /
        improvisedObs.length;
      const delta = Number((empirical - meanTopProb).toFixed(3));
      const existing = summary.byStyle.find((s) => s.style === 'improvised');
      if (existing) {
        existing.showModeCalibrationDelta = delta;
      } else {
        summary.byStyle.push({
          style: 'improvised',
          predictions: improvisedObs.length,
          brier: 0,
          precisionTop10: 0,
          recallActual: 0,
          recallTop15: 0,
          calibrationError: 0,
          showModeCalibrationDelta: delta,
        });
      }
    }

    const [inserted] = await db
      .insert(predictionEvalRuns)
      .values({
        predictions: summary.predictionCount,
        brierScore: summary.brierScore,
        calibrationCurve: curve,
        precisionTop10: summary.precisionTop10,
        recallTop10: summary.recallTop10,
        recallTop15: summary.recallTop15,
        windowDays,
        byStyle: summary.byStyle,
      })
      .returning({ id: predictionEvalRuns.id });
    const runId = inserted?.id ?? null;

    if (runId && rows.length > 0) {
      await db.insert(predictionEvalShows).values(
        rows.map((row) => ({
          runId,
          tourSetlistId: row.tourSetlistId,
          performerId: row.performerId,
          performerName: row.performerName,
          performanceDate: row.performanceDate,
          style: row.style,
          brier: row.brier,
          precisionTop10: row.precisionTop10,
          recallActual: row.recallActual,
          recallTop15: row.recallTop15,
          sampleSize: row.sampleSize,
          predicted: row.predicted,
          actual: row.actual,
        })),
      );
    }

    for (const style of summary.byStyle) {
      log.info(
        {
          event: 'eval.metrics.summary',
          date: today,
          style: style.style,
          brier: style.brier,
          p10: style.precisionTop10,
          recallTop15: style.recallTop15,
          calibrationError: style.calibrationError,
          sampleSize: style.predictions,
          showModeCalibrationDelta:
            style.showModeCalibrationDelta ?? null,
        },
        'Per-style eval summary',
      );
    }

    log.info(
      {
        event: 'eval.run.complete',
        runId,
        windowDays,
        evaluatedShows: rows.length,
        predictionCount: summary.predictionCount,
        brierScore: summary.brierScore,
        precisionTop10: summary.precisionTop10,
        recallTop15: summary.recallTop15,
        calibrationError: summary.calibrationError,
      },
      'Daily prediction-eval back-test complete',
    );

    return {
      runId,
      windowDays,
      evaluatedShows: rows.length,
      predictionCount: summary.predictionCount,
      brierScore: summary.brierScore,
      precisionTop10: summary.precisionTop10,
      recallTop10: summary.recallTop10,
      recallTop15: summary.recallTop15,
      calibrationError: summary.calibrationError,
      byStyle: summary.byStyle,
    };
  } catch (err) {
    log.error({ err, event: 'eval.run.failed' }, 'Prediction eval back-test failed');
    throw err;
  }
}
