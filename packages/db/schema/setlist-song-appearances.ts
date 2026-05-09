import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  pgTable,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { performers } from './performers';
import { shows } from './shows';
import { songs } from './songs';
import { tourSetlists } from './tour-setlists';

// Denormalized index of every song-in-a-setlist occurrence — both attended
// (`show_id` set) and corpus (`tour_setlist_id` set). One row per song slot.
//
// The `role` column is computed at fill time from song position so the
// prediction pipeline can group by role without re-walking the setlist JSON:
//   'opener'        — first song of the first non-encore section
//   'closer'        — last song before any encore
//   'encore_open'   — first song of the encore section
//   'encore_close'  — last song of the entire setlist
//   'core'          — everything else
//
// This denormalization is what makes every stats query and prediction cheap.
// The source of truth for *display* stays `shows.setlists` jsonb / setlist
// JSON on `tour_setlists`; this index is rebuildable from scratch via the
// indexer job.
export const setlistSongAppearances = pgTable(
  'setlist_song_appearances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    songId: uuid('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id, { onDelete: 'cascade' }),
    performanceDate: date('performance_date').notNull(),
    showId: uuid('show_id').references(() => shows.id, { onDelete: 'cascade' }),
    tourSetlistId: uuid('tour_setlist_id').references(() => tourSetlists.id, {
      onDelete: 'cascade',
    }),
    sectionIndex: smallint('section_index').notNull(),
    songIndex: smallint('song_index').notNull(),
    isEncore: boolean('is_encore').notNull().default(false),
    role: text('role').notNull().default('core'),
    tourId: text('tour_id'),
    tourName: text('tour_name'),
  },
  (table) => [
    index('appearances_song_date_idx').on(
      table.songId,
      table.performanceDate.desc(),
    ),
    index('appearances_performer_date_idx').on(
      table.performerId,
      table.performanceDate.desc(),
    ),
    index('appearances_show_idx')
      .on(table.showId)
      .where(sql`${table.showId} IS NOT NULL`),
    index('appearances_performer_tour_date_idx').on(
      table.performerId,
      table.tourId,
      table.performanceDate.desc(),
    ),
  ],
);
