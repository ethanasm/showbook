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
 * Spec: showbook-specs/setlist-intelligence/phases/phase-04-eval-harness.md
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
  inferStyle,
  loadTruncatedCorpus,
  mergeCalibrationBuckets,
  predictSetlist,
  recallAtK,
  setlistTitles,
  type CalibrationBin,
  type EvalStyle,
  type PerShowEvalRow,
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
export { rerunEvalForShow, evaluateShow } from '@showbook/api';

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
          .select({ id: performers.id, name: performers.name })
          .from(performers)
          .where(inArray(performers.id, performerIds))
      : [];
    const performerName = new Map(performerRows.map((p) => [p.id, p.name]));

    const rows: PerShowEvalRow[] = [];
    let curve = emptyCalibrationCurve(10);

    for (const tsRow of setlistsInWindow) {
      const corpus = await loadTruncatedCorpus({
        performerId: tsRow.performerId,
        targetDate: tsRow.performanceDate,
      });
      const prediction = predictSetlist({
        performerId: tsRow.performerId,
        targetDate: tsRow.performanceDate,
        corpus,
      });
      if (prediction.style !== 'stable') {
        continue;
      }
      const actualTitles = setlistTitles(tsRow.setlist as PerformerSetlist);
      if (actualTitles.length === 0) continue;
      const flat = flattenPrediction(prediction);
      const row = evaluateShow({
        tourSetlistId: tsRow.id,
        performerId: tsRow.performerId,
        performerName: performerName.get(tsRow.performerId) ?? 'Unknown',
        performanceDate: tsRow.performanceDate,
        predicted: flat,
        sampleSize: prediction.sampleSize,
        actualTitles,
        style: inferStyle(tsRow.performerId),
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

    const summary = summarizeRun(rows, curve);

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
