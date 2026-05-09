import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { performers } from './performers';

// First-class song entity, scoped per-performer. Keyed display by `(performer,
// LOWER(title))` — case-folded so "Heroes" and "heroes" collapse. Spotify track
// id is `null` until the resolver job (Phase 3) populates it; the sentinel
// value '__none__' marks negative-cache misses so we don't re-search forever.
//
// The four `historical_*` / `current_gap_*` columns power the §15c gap-based
// rotating-style prediction added in Phase 5; declared here so the schema
// migration that creates `songs` doesn't have to be amended later.
export const songs = pgTable(
  'songs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    isCover: boolean('is_cover').notNull().default(false),
    coverOf: text('cover_of'),
    spotifyTrackId: text('spotify_track_id'),
    durationMs: integer('duration_ms'),
    firstKnownPerformance: date('first_known_performance'),
    historicalPlayCount: integer('historical_play_count').notNull().default(0),
    historicalMeanGap: real('historical_mean_gap'),
    lastPlayedDate: date('last_played_date'),
    currentGapShows: integer('current_gap_shows'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('songs_performer_title_idx').on(
      table.performerId,
      sql`LOWER(${table.title})`,
    ),
    index('songs_spotify_idx')
      .on(table.spotifyTrackId)
      .where(sql`${table.spotifyTrackId} IS NOT NULL`),
    // Hot path for the gap-based rotating prediction: rank a performer's
    // catalogue by current overdue-ness once the song has enough history to
    // mean something (≥3 plays).
    index('songs_overdue_idx')
      .on(table.performerId, table.currentGapShows.desc())
      .where(sql`${table.historicalPlayCount} >= 3`),
  ],
);
