import {
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { performers } from './performers';

// Phase 11 (§15m) — canonical release-date catalog. Populated by the
// `album-metadata-fill` cron (02:30 ET nightly) via Spotify's
// `/v1/artists/{id}/albums` endpoint. The §15m album-drop forward
// signal joins this against `predictSetlist` calls: when the target
// date sits within ±60 days of a release, synthetic Tier-A
// appearances are seeded for the new-album track ids.
export const albums = pgTable(
  'albums',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id, { onDelete: 'cascade' }),
    spotifyAlbumId: text('spotify_album_id').notNull(),
    name: text('name').notNull(),
    releaseDate: date('release_date').notNull(),
    albumType: text('album_type'),
    trackIds: text('track_ids').array().notNull(),
    fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('albums_spotify_unique').on(table.spotifyAlbumId),
    index('albums_performer_release_idx').on(
      table.performerId,
      table.releaseDate.desc(),
    ),
  ],
);
