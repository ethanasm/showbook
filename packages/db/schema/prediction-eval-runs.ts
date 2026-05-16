import { integer, jsonb, pgTable, real, timestamp, uuid } from 'drizzle-orm/pg-core';

// Output of the back-test eval harness (Phase 4). Each row is one cron run —
// for every (performer, date) pair in the past 30 days of `tour_setlists`,
// re-predict against a corpus truncated to before that date and compare to
// what actually played.
//
// `brier_score` is the mean squared error between predicted probability and
// actual played (1.0 / 0.0). `calibration_curve` is a per-bin breakdown
// (0–20, 20–40, …, 80–100). `by_style` carries the same metrics broken out
// per setlist style so we can see the rotating-style cohort separately.
//
// The table ships in Phase 0 so Phase 4's cron can write here without an
// extra migration.
export const predictionEvalRuns = pgTable('prediction_eval_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  ranAt: timestamp('ran_at').defaultNow().notNull(),
  predictions: integer('predictions').notNull(),
  brierScore: real('brier_score').notNull(),
  calibrationCurve: jsonb('calibration_curve').notNull(),
  precisionTop10: real('precision_top10').notNull(),
  recallTop10: real('recall_top10').notNull(),
  byStyle: jsonb('by_style').notNull(),
});
