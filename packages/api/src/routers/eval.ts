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
import { asc, desc, eq, gte } from 'drizzle-orm';
import {
  performers,
  predictionEvalRuns,
  predictionEvalShows,
  specialEventRules,
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

  // ─────────────────────────────────────────────────────────────────
  // Phase 11 §15g — special-event rules CRUD
  // ─────────────────────────────────────────────────────────────────

  /** List every active special-event rule, joined with the performer
   *  name so the admin UI doesn't need a second roundtrip. */
  listSpecialEventRules: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: specialEventRules.id,
        performerId: specialEventRules.performerId,
        performerName: performers.name,
        ruleKind: specialEventRules.ruleKind,
        pattern: specialEventRules.pattern,
        effect: specialEventRules.effect,
        source: specialEventRules.source,
        active: specialEventRules.active,
        createdAt: specialEventRules.createdAt,
      })
      .from(specialEventRules)
      .innerJoin(performers, eq(performers.id, specialEventRules.performerId))
      .orderBy(asc(performers.name), desc(specialEventRules.createdAt));
    return rows;
  }),

  upsertSpecialEventRule: adminProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        performerId: z.string().uuid(),
        ruleKind: z.enum(['date_match', 'venue_run', 'tour_name_pattern']),
        pattern: z.record(z.string(), z.unknown()),
        effect: z.object({
          copy: z.string().min(1).max(500),
          sampleCount: z.number().int().min(1).max(20).optional(),
        }),
        active: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        await ctx.db
          .update(specialEventRules)
          .set({
            performerId: input.performerId,
            ruleKind: input.ruleKind,
            pattern: input.pattern,
            effect: input.effect,
            active: input.active,
          })
          .where(eq(specialEventRules.id, input.id));
        log.info(
          { event: 'eval.special_event_rule.updated', ruleId: input.id },
          'Special-event rule updated',
        );
        return { id: input.id, updated: true };
      }
      const [inserted] = await ctx.db
        .insert(specialEventRules)
        .values({
          performerId: input.performerId,
          ruleKind: input.ruleKind,
          pattern: input.pattern,
          effect: input.effect,
          source: 'manual',
          active: input.active,
        })
        .returning({ id: specialEventRules.id });
      log.info(
        { event: 'eval.special_event_rule.created', ruleId: inserted?.id },
        'Special-event rule created',
      );
      return { id: inserted!.id, updated: false };
    }),

  deleteSpecialEventRule: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(specialEventRules)
        .where(eq(specialEventRules.id, input.id));
      log.info(
        { event: 'eval.special_event_rule.deleted', ruleId: input.id },
        'Special-event rule deleted',
      );
      return { id: input.id };
    }),
});

export type EvalRouter = typeof evalRouter;
