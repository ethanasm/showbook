/**
 * Registry of Spotify-shaped data on the schema, categorized by what
 * `disconnectSpotify` should do with it on user disconnect. See SI-09
 * in showbook-specs/setlist-intelligence/plan-review.md.
 *
 * Why this exists: Spotify-derived columns + tables land across
 * multiple phases of the setlist-intelligence rollout (Phase 0 token
 * storage, Phase 3 playlist URLs + track-resolution catalog, Phase 7
 * priming counts + year-end playlist IDs, Phase 9 skipped-artists
 * list, etc.). Without a single place to enumerate them, the next
 * column-adder writes ad-hoc cleanup into `disconnectSpotify` (or
 * forgets), and we ship a privacy bug: user disconnects → personal
 * stats stick around forever.
 *
 * The companion test (`spotify-disconnect-registry.test.ts`) walks
 * every pgTable exported from `@showbook/db`, finds anything
 * Spotify-shaped (table name starting `user_spotify_`, or any column
 * whose name contains `spotify`), and asserts each appears in
 * EXACTLY ONE of the four lists below. Anything missing fails the
 * build, forcing an explicit categorization decision in the PR that
 * adds the column.
 *
 * V1 (Phase 0) ships the arrays empty. Phases 3, 7, 8, 9, 11 add
 * entries as they land columns. The scan test runs on every CI
 * build, so the contract enforces itself.
 */

/** A user-personal column that's cleared (set to NULL) on disconnect. */
export interface UserScopedPurgeColumn {
  /** Drizzle table name in the DB (e.g. 'shows', 'users'). */
  table: string;
  /** Column to clear. */
  column: string;
  /** Column on `table` that holds the disconnecting user's id. */
  filter: string;
}

/** A user-scoped table whose rows are DELETEd for the disconnecting user. */
export interface UserScopedPurgeTable {
  /** Drizzle table name (e.g. 'user_spotify_skipped_artists'). */
  table: string;
  /** Column on `table` that holds the disconnecting user's id. */
  filter: string;
}

/**
 * User-personal Spotify-derived columns to clear on disconnect.
 * Grows as Phases 3, 7+ ship columns. Phase 0 is empty.
 */
export const USER_SCOPED_PURGE_COLUMNS: readonly UserScopedPurgeColumn[] = [
  // Phase 3: the playlist-url columns originally proposed in the spec
  // were replaced by a dedicated `show_spotify_playlists` table (see
  // USER_SCOPED_PURGE_TABLES below), which lets a single show carry
  // multiple kinds (hype + heard) without proliferating columns. The
  // legacy stubs are kept here for plan-fidelity:
  //   { table: 'shows', column: 'spotify_playlist_url', filter: 'user_id' },
  //   { table: 'shows', column: 'spotify_attended_playlist_url', filter: 'user_id' },
  // Phase 7 will add:
  //   { table: 'shows', column: 'spotify_prep_track_count', filter: 'user_id' },
  //   { table: 'shows', column: 'spotify_post_track_count', filter: 'user_id' },
  //   { table: 'users', column: 'spotify_year_playlists', filter: 'id' },
];

/**
 * Whole user-scoped Spotify tables to DELETE on disconnect.
 * Grows in Phase 9. Phase 0 is empty.
 */
export const USER_SCOPED_PURGE_TABLES: readonly UserScopedPurgeTable[] = [
  // Phase 3 — the (showId, userId, kind) row referencing a Showbook-
  // created Spotify playlist. Wiping these on disconnect means
  // re-connecting and re-creating the playlist starts a clean
  // idempotency record; the playlists themselves stay on Spotify
  // (we never delete from Spotify on disconnect).
  { table: 'show_spotify_playlists', filter: 'user_id' },
  // Phase 9 will add:
  //   { table: 'user_spotify_skipped_artists', filter: 'user_id' },
];

/**
 * Spotify-shaped data that is CATALOG-shared across all users.
 * Disconnect leaves these untouched — wiping them would break the
 * feature for every other user who has the same song in their
 * setlists. Listed here so the schema-scan test treats them as
 * intentionally kept, not "you forgot to handle this."
 *
 * Format: 'tableName.columnName' (db column name, snake_case).
 */
export const CATALOG_KEEP_COLUMNS: readonly string[] = [
  // Phase 0 shipped the column on `songs` even though the
  // resolver job lands in Phase 3 — kept here so the scan-test
  // passes from day 1.
  'songs.spotify_track_id',
  // Phase 3 will add:
  //   'songs.spotify_track_id_resolved_at',
  // Phase 7 (catalog audio metadata):
  //   'songs.spotify_audio_features',
  // Phase 9:
  //   'songs.spotify_preview_url',
  // Phase 11+ (Spotify catalog metadata):
  //   'songs.isrc',
  //   'songs.spotify_album_id',
  //   'songs.spotify_album_name',
  //   'songs.spotify_album_release',
  //   'songs.spotify_album_type',
];

/**
 * User-scoped Spotify tables/columns intentionally NOT purged on
 * disconnect. Typically because they hold an audit trail (the token
 * row itself stays for 30 days after revoke for support visibility;
 * Phase 11's `spotify/purge-revoked-tokens` cron hard-deletes after
 * that).
 *
 * Format: 'tableName' for whole-table keep,
 * 'tableName.columnName' for column-level keep.
 */
export const USER_SCOPED_AUDIT: readonly string[] = [
  // The token row itself. `disconnectSpotify` marks revoked_at but
  // doesn't delete; Phase 11's hard-delete cron handles cleanup
  // after 30 days. The scan test covers every column on this table
  // by listing the table here (no need to enumerate
  // spotifyUserId, accessTokenEnc, etc. individually).
  'user_spotify_tokens',
];
