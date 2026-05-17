import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { shows } from './shows';
import { performers } from './performers';

export const enrichmentTypeEnum = pgEnum('enrichment_type', ['setlist']);

export const enrichmentQueue = pgTable(
  'enrichment_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    // Per-artist scope. Festivals enqueue one row per lineup performer so each
    // artist gets an independent retry budget; concerts enqueue a single row
    // pointing at the headliner.
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id, { onDelete: 'cascade' }),
    type: enrichmentTypeEnum('type').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(14),
    nextRetry: timestamp('next_retry').notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('enrichment_queue_show_performer_type_uq').on(
      table.showId,
      table.performerId,
      table.type,
    ),
  ],
);
