import {
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { PerformerSetlist } from '@showbook/shared';
import { performers } from './performers';

// Cache of setlist.fm setlists *beyond* the user's own attended shows.
// Lazy-filled per-artist by the `setlist-corpus-fill` job (Phase 1) and used
// as the corpus for the predicted-setlist algorithm (Phase 1+).
//
// `tour_id` is synthesized from `(performerId, lower(tour.name))` because
// setlist.fm doesn't expose its per-tour identifier in the JSON payload — the
// website uses URL slugs we'd have to scrape. Collisions on a re-used tour
// name are intentional (same artist re-using a tour name *is* the equivalence
// we want for prediction bucketing).
//
// `song_count` is denormalized so the prediction pipeline doesn't have to
// re-parse the JSON for every weight calc.
export const tourSetlists = pgTable(
  'tour_setlists',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id, { onDelete: 'cascade' }),
    tourId: text('tour_id'),
    tourName: text('tour_name'),
    tourLeg: text('tour_leg'),
    performanceDate: date('performance_date').notNull(),
    venueNameRaw: text('venue_name_raw'),
    city: text('city'),
    countryCode: text('country_code'),
    setlistfmId: text('setlistfm_id').notNull(),
    setlist: jsonb('setlist').$type<PerformerSetlist>().notNull(),
    songCount: smallint('song_count').notNull(),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tour_setlists_setlistfm_unique').on(table.setlistfmId),
    index('tour_setlists_performer_date_idx').on(
      table.performerId,
      table.performanceDate.desc(),
    ),
    index('tour_setlists_performer_tour_idx').on(
      table.performerId,
      table.tourId,
      table.performanceDate.desc(),
    ),
  ],
);
