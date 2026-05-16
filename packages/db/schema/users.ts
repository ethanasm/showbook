import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email'),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  // Phase 7 of setlist-intelligence — { [year]: spotifyPlaylistId }. The
  // Dec-31 year-end-soundtrack cron writes here; on re-run for the same
  // year it overwrites the existing Spotify playlist rather than creating
  // a duplicate.
  spotifyYearPlaylists: jsonb('spotify_year_playlists').$type<Record<string, string>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
