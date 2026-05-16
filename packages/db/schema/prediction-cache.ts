import { date, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { performers } from './performers';

// Server-side cache of `predictSetlist({ performerId, targetDate })` outputs.
// Keyed by `(performerId, targetDate)`; `corpus_signature` carries the
// `max(tour_setlists.fetched_at)` value the cached prediction was computed
// against — refreshed reads compare it to the current corpus to decide
// whether to invalidate. The corpus-fill job clears entries for the
// performer when it touches a setlist.
//
// `prediction_json` carries the full discriminated union (stable / rotating /
// theatrical / improvised / cold) so the consumer doesn't need to re-resolve
// anything besides JSON parsing.
export const predictionCache = pgTable(
  'prediction_cache',
  {
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id, { onDelete: 'cascade' }),
    targetDate: date('target_date').notNull(),
    corpusSignature: text('corpus_signature').notNull(),
    predictionJson: jsonb('prediction_json').notNull(),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.performerId, table.targetDate] }),
  ],
);
