import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { shows } from './shows';
import { users } from './users';

// Per-(show, user, kind) record of Spotify playlists we've created.
// `kind` is 'hype' (pre-show, predicted setlist) or 'heard' (post-show,
// actual setlist). Unique (show_id, user_id, kind) gives idempotency:
// re-tapping the playlist button returns the existing playlist row
// instead of creating a duplicate.
//
// `playlist_id` is Spotify's id (used to PUT cover art / GET to verify
// the playlist still exists). `spotify_url` is the human-facing
// `external_urls.spotify` value we surface in the toast / button.
//
// Phase 3 of setlist-intelligence — see
// specs/setlist-intelligence/phases/phase-03-spotify-export.md.
export const showSpotifyPlaylists = pgTable(
  'show_spotify_playlists',
  {
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    playlistId: text('playlist_id').notNull(),
    spotifyUrl: text('spotify_url').notNull(),
    trackCount: integer('track_count').notNull(),
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('show_spotify_playlists_show_user_kind_idx').on(
      table.showId,
      table.userId,
      table.kind,
    ),
  ],
);
