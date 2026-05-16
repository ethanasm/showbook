/**
 * Per-show prediction-eval primitives. Built on top of `eval-metrics.ts`
 * and the `predictSetlist` algorithm. The pg-boss handler in
 * `@showbook/jobs/prediction-eval` walks the corpus and calls
 * `evaluateShow` once per (performer, date); the operator-facing
 * `eval.rerunShow` tRPC mutation calls `rerunEvalForShow` directly.
 *
 * Lives in @showbook/api so the tRPC router can invoke it without
 * dragging the @showbook/jobs runtime (and creating an import cycle).
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import {
  db,
  performers,
  predictionEvalRuns,
  predictionEvalShows,
  tourSetlists,
  type EvalShowPredictedTitle,
} from '@showbook/db';
import { child } from '@showbook/observability';
import type { PerformerSetlist } from '@showbook/shared';
import {
  brierScore,
  precisionAtK,
  recallActual,
  recallAtK,
  type PredictedSongLike,
} from './eval-metrics';
import {
  predictSetlist,
  type CorpusRow,
  type HotPrediction,
} from './setlist-predict';

const log = child({ component: 'api.eval-show' });
const MS_PER_DAY = 86_400_000;

/** Style label persisted alongside each per-show row. Phase 1 only emits
 * `stable`; the four-way classifier from Phase 5 will replace this. */
export type EvalStyle = 'stable' | 'rotating' | 'theatrical' | 'improvised';

export interface PerShowEvalRow {
  tourSetlistId: string;
  performerId: string;
  performerName: string;
  performanceDate: string;
  style: EvalStyle;
  brier: number;
  precisionTop10: number;
  recallActual: number;
  recallTop15: number;
  sampleSize: number;
  predicted: EvalShowPredictedTitle[];
  actual: string[];
}

/** Flatten a setlist payload to a list of distinct lower-cased titles. */
export function setlistTitles(setlist: PerformerSetlist): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const section of setlist.sections) {
    for (const song of section.songs) {
      const lower = song.title.trim().toLowerCase();
      if (lower.length === 0 || seen.has(lower)) continue;
      seen.add(lower);
      out.push(song.title);
    }
  }
  return out;
}

/** Coerce a HotPrediction to the metric helpers' flat shape. */
export function flattenPrediction(prediction: HotPrediction): PredictedSongLike[] {
  return [
    ...prediction.core,
    ...prediction.likely,
    ...prediction.wildcards,
    ...prediction.rotation,
  ].map((s) => ({ title: s.title, probability: s.probability }));
}

/** Phase 1 emits `stable` only. Placeholder until the classifier lands. */
export function inferStyle(_performerId: string): EvalStyle {
  return 'stable';
}

/** Pure evaluation — given one prediction + the actual titles, compute the
 * persisted shape. No DB writes; the caller persists. */
export function evaluateShow(opts: {
  tourSetlistId: string;
  performerId: string;
  performerName: string;
  performanceDate: string;
  predicted: PredictedSongLike[];
  sampleSize: number;
  actualTitles: string[];
  style: EvalStyle;
}): PerShowEvalRow {
  const actualLower = opts.actualTitles.map((t) => t.trim().toLowerCase());
  const predicted: EvalShowPredictedTitle[] = opts.predicted.map((s) => ({
    title: s.title,
    probability: s.probability,
    hit: actualLower.includes(s.title.trim().toLowerCase()),
  }));
  return {
    tourSetlistId: opts.tourSetlistId,
    performerId: opts.performerId,
    performerName: opts.performerName,
    performanceDate: opts.performanceDate,
    style: opts.style,
    brier: brierScore({ predicted: opts.predicted, actualTitles: opts.actualTitles }),
    precisionTop10: precisionAtK({
      predicted: opts.predicted,
      actualTitles: opts.actualTitles,
      k: 10,
    }),
    recallActual: recallActual({
      predicted: opts.predicted,
      actualTitles: opts.actualTitles,
    }),
    recallTop15: recallAtK({
      predicted: opts.predicted,
      actualTitles: opts.actualTitles,
      k: 15,
    }),
    sampleSize: opts.sampleSize,
    predicted,
    actual: opts.actualTitles,
  };
}

/**
 * Load a corpus snapshot truncated to `performance_date < targetDate`.
 * Pure data fetch — no cache reads/writes. Mirrors
 * `loadCorpusForPrediction` but stops short of the target date so we can
 * back-test "the prediction the algorithm would have made the day before."
 */
export async function loadTruncatedCorpus(opts: {
  performerId: string;
  targetDate: string;
}): Promise<CorpusRow[]> {
  const earliest = new Date(new Date(opts.targetDate).getTime() - 365 * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const rows = await db
    .select({
      id: tourSetlists.id,
      performerId: tourSetlists.performerId,
      performanceDate: tourSetlists.performanceDate,
      tourId: tourSetlists.tourId,
      tourName: tourSetlists.tourName,
      setlist: tourSetlists.setlist,
      songCount: tourSetlists.songCount,
      fetchedAt: tourSetlists.fetchedAt,
    })
    .from(tourSetlists)
    .where(
      and(
        eq(tourSetlists.performerId, opts.performerId),
        sql`${tourSetlists.performanceDate} >= ${earliest}`,
        sql`${tourSetlists.performanceDate} < ${opts.targetDate}`,
      ),
    )
    .orderBy(desc(tourSetlists.performanceDate));
  return rows.map((r) => ({
    id: r.id,
    performerId: r.performerId,
    performanceDate: r.performanceDate,
    tourId: r.tourId,
    tourName: r.tourName,
    setlist: r.setlist as PerformerSetlist,
    songCount: r.songCount,
    fetchedAt: r.fetchedAt,
  }));
}

/**
 * Re-evaluate one tour-setlist and overwrite any existing per-show row
 * attached to `attachToRunId`. Returns null when the prediction lands in
 * a cold state — there's nothing to score.
 */
export async function rerunEvalForShow(opts: {
  tourSetlistId: string;
  attachToRunId?: string | null;
}): Promise<PerShowEvalRow | null> {
  const [row] = await db
    .select({
      id: tourSetlists.id,
      performerId: tourSetlists.performerId,
      performanceDate: tourSetlists.performanceDate,
      setlist: tourSetlists.setlist,
    })
    .from(tourSetlists)
    .where(eq(tourSetlists.id, opts.tourSetlistId))
    .limit(1);
  if (!row) return null;

  const [perfRow] = await db
    .select({ id: performers.id, name: performers.name })
    .from(performers)
    .where(eq(performers.id, row.performerId))
    .limit(1);
  if (!perfRow) return null;

  const corpus = await loadTruncatedCorpus({
    performerId: row.performerId,
    targetDate: row.performanceDate,
  });
  const prediction = predictSetlist({
    performerId: row.performerId,
    targetDate: row.performanceDate,
    corpus,
  });
  if (prediction.style !== 'stable') {
    log.info(
      {
        event: 'eval.show.cold',
        tourSetlistId: opts.tourSetlistId,
        performerId: row.performerId,
      },
      'Re-eval landed in cold state — skipping',
    );
    return null;
  }
  const actualTitles = setlistTitles(row.setlist as PerformerSetlist);
  const result = evaluateShow({
    tourSetlistId: row.id,
    performerId: row.performerId,
    performerName: perfRow.name,
    performanceDate: row.performanceDate,
    predicted: flattenPrediction(prediction),
    sampleSize: prediction.sampleSize,
    actualTitles,
    style: inferStyle(row.performerId),
  });

  if (opts.attachToRunId) {
    await db
      .delete(predictionEvalShows)
      .where(
        and(
          eq(predictionEvalShows.runId, opts.attachToRunId),
          eq(predictionEvalShows.tourSetlistId, result.tourSetlistId),
        ),
      );
    await db.insert(predictionEvalShows).values({
      runId: opts.attachToRunId,
      tourSetlistId: result.tourSetlistId,
      performerId: result.performerId,
      performerName: result.performerName,
      performanceDate: result.performanceDate,
      style: result.style,
      brier: result.brier,
      precisionTop10: result.precisionTop10,
      recallActual: result.recallActual,
      recallTop15: result.recallTop15,
      sampleSize: result.sampleSize,
      predicted: result.predicted,
      actual: result.actual,
    });
  }

  log.info(
    {
      event: 'eval.show.rerun',
      tourSetlistId: opts.tourSetlistId,
      performerId: row.performerId,
      brier: result.brier,
      precisionTop10: result.precisionTop10,
      recallTop15: result.recallTop15,
    },
    'Re-evaluated single show',
  );
  return result;
}

/** Convenience for the eval router — most recent run id (or null). */
export async function latestRunId(): Promise<string | null> {
  const [row] = await db
    .select({ id: predictionEvalRuns.id })
    .from(predictionEvalRuns)
    .orderBy(desc(predictionEvalRuns.ranAt))
    .limit(1);
  return row?.id ?? null;
}
