import { date, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { performers } from './performers';
import { shows } from './shows';
import { users } from './users';

// Append-only audit of every prediction served to a user. `prediction_cache`
// is keyed by (performerId, targetDate) and overwrites on each refresh —
// useful for read latency, useless for "what did the user actually see two
// weeks ago?" The eval harness compares the played setlist against the
// truncated-corpus prediction (the spec approach), but having snapshots on
// disk also lets a later eval pass score against the exact prediction the
// user was shown, which is the ground truth for spoiler discipline and
// confidence claims.
//
// `served_to_user_id` and `show_id` are nullable so server-side back-tests
// and operator-triggered re-runs can write snapshots that aren't tied to a
// user impression.
export const predictionSnapshots = pgTable(
  'prediction_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id, { onDelete: 'cascade' }),
    targetDate: date('target_date').notNull(),
    servedToUserId: text('served_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    showId: uuid('show_id').references(() => shows.id, {
      onDelete: 'set null',
    }),
    corpusSignature: text('corpus_signature').notNull(),
    predictionJson: jsonb('prediction_json').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('prediction_snapshots_performer_date_idx').on(
      table.performerId,
      table.targetDate.desc(),
    ),
    index('prediction_snapshots_show_idx').on(table.showId),
  ],
);
