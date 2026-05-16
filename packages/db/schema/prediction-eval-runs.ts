import { date, index, integer, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { performers } from './performers';
import { tourSetlists } from './tour-setlists';

// Output of the back-test eval harness (Phase 4). Each row is one cron run —
// for every (performer, date) pair in the past N days of `tour_setlists`,
// re-predict against a corpus truncated to before that date and compare to
// what actually played.
//
// `brier_score` is the mean squared error between predicted probability and
// actual played (1.0 / 0.0). `calibration_curve` is a per-bin breakdown
// (10 deciles, 0–10, 10–20, …, 90–100). `by_style` carries the same metrics
// broken out per setlist style so we can see the rotating-style cohort
// separately. `recall_top15` was added in Phase 4 for the rotating-style
// gate (SI-14); existing rows have it as null. `window_days` records the
// trailing window the harness used so a later schedule change doesn't
// invalidate historical comparisons.
export const predictionEvalRuns = pgTable('prediction_eval_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  ranAt: timestamp('ran_at').defaultNow().notNull(),
  predictions: integer('predictions').notNull(),
  brierScore: real('brier_score').notNull(),
  calibrationCurve: jsonb('calibration_curve').notNull(),
  precisionTop10: real('precision_top10').notNull(),
  recallTop10: real('recall_top10').notNull(),
  recallTop15: real('recall_top15'),
  windowDays: integer('window_days').notNull().default(14),
  byStyle: jsonb('by_style').notNull(),
});

// Per-show breakdown of one eval run. Drives the "most recent N rows" table
// on /admin/eval and the "Re-run for show" button (the tourSetlistId is the
// re-run target). Predicted / actual are stored as title arrays so the
// admin page can render a quick "predicted vs. played" comparison without
// re-hitting the corpus.
export const predictionEvalShows = pgTable(
  'prediction_eval_shows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => predictionEvalRuns.id, { onDelete: 'cascade' }),
    tourSetlistId: uuid('tour_setlist_id').references(() => tourSetlists.id, {
      onDelete: 'set null',
    }),
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id, { onDelete: 'cascade' }),
    performerName: text('performer_name').notNull(),
    performanceDate: date('performance_date').notNull(),
    style: text('style').notNull(),
    brier: real('brier').notNull(),
    precisionTop10: real('precision_top10').notNull(),
    recallActual: real('recall_actual').notNull(),
    recallTop15: real('recall_top15'),
    sampleSize: integer('sample_size').notNull(),
    predicted: jsonb('predicted').$type<EvalShowPredictedTitle[]>().notNull(),
    actual: jsonb('actual').$type<string[]>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('prediction_eval_shows_run_idx').on(
      table.runId,
      table.performanceDate.desc(),
    ),
    index('prediction_eval_shows_performer_date_idx').on(
      table.performerId,
      table.performanceDate.desc(),
    ),
  ],
);

export interface EvalShowPredictedTitle {
  title: string;
  probability: number;
  /** True when the song actually appeared in the played setlist. */
  hit: boolean;
}
