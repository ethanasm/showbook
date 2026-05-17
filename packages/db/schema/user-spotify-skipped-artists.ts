import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

// Phase 9 of setlist-intelligence — per-user dismiss list for the
// Spotify-follow rail on Discover. When the user taps × on a card,
// we write the (userId, spotifyArtistId) pair here so the same
// artist never re-surfaces on the rail. Disconnecting Spotify
// purges this table for the user (see SI-09 registry).
export const userSpotifySkippedArtists = pgTable(
  'user_spotify_skipped_artists',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    spotifyArtistId: text('spotify_artist_id').notNull(),
    skippedAt: timestamp('skipped_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'user_spotify_skipped_artists_pkey',
      columns: [table.userId, table.spotifyArtistId],
    }),
  ],
);
