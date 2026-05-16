/**
 * Admin-only tRPC surface for the Phase 4 prediction-eval harness.
 *
 * Reads the persisted `prediction_eval_runs` / `prediction_eval_shows`
 * tables; the job that populates them lives in @showbook/jobs. The
 * `runNow` and `rerunShow` mutations let the operator force a fresh
 * back-test (useful after a setlist correction) without waiting for the
 * 03:00 ET cron.
 */

import { z } from 'zod';
import { desc, gte } from 'drizzle-orm';
import {
  predictionEvalRuns,
  predictionEvalShows,
  type EvalShowPredictedTitle,
} from '@showbook/db';
import { child } from '@showbook/observability';
import { adminProcedure, router } from '../trpc';
import { latestRunId, rerunEvalForShow } from '../eval-show';

const log = child({ component: 'api.eval' });

const summaryInput = z
  .object({ days: z.number().int().min(1).max(180).default(30) })
  .default({ days: 30 });

const recentShowsInput = z
  .object({ limit: z.number().int().min(1).max(200).default(50) })
  .default({ limit: 50 });

const rerunShowInput = z.object({
  tourSetlistId: z.string().uuid(),
});

interface CalibrationBinPayload {
  lower: number;
  upper: number;
  predictions: number;
  meanProbability: number;
  empiricalRate: number;
  delta: number;
}

export const evalRouter = router({
  /**
   * Trailing N-day summary: one entry per run with the aggregate
   * metrics. The admin page renders this as a line chart.
   */
  summary: adminProcedure.input(summaryInput).query(async ({ ctx, input }) => {
    const since = new Date(Date.now() - input.days * 86_400_000);
    const rows = await ctx.db
      .select({
        id: predictionEvalRuns.id,
        ranAt: predictionEvalRuns.ranAt,
        predictions: predictionEvalRuns.predictions,
        brierScore: predictionEvalRuns.brierScore,
        precisionTop10: predictionEvalRuns.precisionTop10,
        recallTop10: predictionEvalRuns.recallTop10,
        recallTop15: predictionEvalRuns.recallTop15,
        windowDays: predictionEvalRuns.windowDays,
        byStyle: predictionEvalRuns.byStyle,
      })
      .from(predictionEvalRuns)
      .where(gte(predictionEvalRuns.ranAt, since))
      .orderBy(desc(predictionEvalRuns.ranAt));
    return rows;
  }),

  /** Most-recent run + its full payload — drives the calibration curve. */
  latest: adminProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(predictionEvalRuns)
      .orderBy(desc(predictionEvalRuns.ranAt))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      ranAt: row.ranAt,
      predictions: row.predictions,
      brierScore: row.brierScore,
      precisionTop10: row.precisionTop10,
      recallTop10: row.recallTop10,
      recallTop15: row.recallTop15,
      windowDays: row.windowDays,
      calibrationCurve: row.calibrationCurve as CalibrationBinPayload[],
      byStyle: row.byStyle,
    };
  }),

  /**
   * Most recent per-show breakdown rows — newest run first. Each row
   * carries enough metadata that the admin page can render a "predicted
   * vs played" comparison without re-hitting the corpus.
   */
  recentShows: adminProcedure
    .input(recentShowsInput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: predictionEvalShows.id,
          runId: predictionEvalShows.runId,
          tourSetlistId: predictionEvalShows.tourSetlistId,
          performerId: predictionEvalShows.performerId,
          performerName: predictionEvalShows.performerName,
          performanceDate: predictionEvalShows.performanceDate,
          style: predictionEvalShows.style,
          brier: predictionEvalShows.brier,
          precisionTop10: predictionEvalShows.precisionTop10,
          recallActual: predictionEvalShows.recallActual,
          recallTop15: predictionEvalShows.recallTop15,
          sampleSize: predictionEvalShows.sampleSize,
          predicted: predictionEvalShows.predicted,
          actual: predictionEvalShows.actual,
          createdAt: predictionEvalShows.createdAt,
        })
        .from(predictionEvalShows)
        .orderBy(desc(predictionEvalShows.createdAt))
        .limit(input.limit);
      return rows.map((r) => ({
        ...r,
        predicted: r.predicted as EvalShowPredictedTitle[],
        actual: r.actual as string[],
      }));
    }),

  /**
   * Re-evaluate one tour-setlist against the current corpus and overwrite
   * any existing row for that (latest run, tour_setlist). Useful when a
   * setlist correction lands and the operator wants the metrics to
   * reflect it without waiting until 03:00 ET.
   */
  rerunShow: adminProcedure
    .input(rerunShowInput)
    .mutation(async ({ ctx, input }) => {
      log.info(
        { event: 'eval.show.rerun.requested', tourSetlistId: input.tourSetlistId },
        'Admin requested per-show re-evaluation',
      );
      const runId = await latestRunId();
      const result = await rerunEvalForShow({
        tourSetlistId: input.tourSetlistId,
        attachToRunId: runId,
      });
      return result;
    }),
});

export type EvalRouter = typeof evalRouter;
