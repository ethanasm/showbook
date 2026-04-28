import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { venues } from './venues';

export const scrapeRunStatusEnum = pgEnum('scrape_run_status', [
  'running',
  'success',
  'error',
]);

export const venueScrapeRuns = pgTable(
  'venue_scrape_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
    status: scrapeRunStatusEnum('status').notNull(),
    eventsFound: integer('events_found').notNull().default(0),
    eventsCreated: integer('events_created').notNull().default(0),
    groqTokensUsed: integer('groq_tokens_used'),
    errorMessage: text('error_message'),
    pageHtmlExcerpt: text('page_html_excerpt'),
  },
  (table) => [index('venue_scrape_runs_venue_idx').on(table.venueId)]
);
