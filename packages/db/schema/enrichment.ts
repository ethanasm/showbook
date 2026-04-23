import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { shows } from './shows';

export const enrichmentTypeEnum = pgEnum('enrichment_type', ['setlist']);

export const enrichmentQueue = pgTable('enrichment_queue', {
  id: uuid('id').defaultRandom().primaryKey(),
  showId: uuid('show_id')
    .notNull()
    .references(() => shows.id),
  type: enrichmentTypeEnum('type').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(14),
  nextRetry: timestamp('next_retry').notNull(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
