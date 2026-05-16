-- Phase 7 of setlist-intelligence — music layer v2.
-- See showbook-specs/setlist-intelligence/phases/phase-07-music-layer-v2.md.
--
-- Adds:
--   shows.spotify_prep_track_count / spotify_post_track_count —
--     per-show priming counts populated by the recently-played
--     nightly cron (08:00 ET). Frozen 6h after the show transitions
--     to past.
--   users.spotify_year_playlists — { "2025": "<spotify-playlist-id>" }
--     so the Dec-31 year-end-soundtrack cron is idempotent: re-running
--     overwrites the existing playlist rather than creating a duplicate.

ALTER TABLE "shows" ADD COLUMN "spotify_prep_track_count" smallint;
--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "spotify_post_track_count" smallint;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "spotify_year_playlists" jsonb;
