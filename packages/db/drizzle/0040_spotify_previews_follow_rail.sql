-- Phase 9 of setlist-intelligence — 30s previews + Spotify-follow rail.
-- See specs/setlist-intelligence/phases/phase-09-follow-rail-previews.md.
--
-- New column:
--   songs.spotify_preview_url — cached 30-second preview clip URL we
--     pulled from Spotify's track lookup. Per CATALOG_KEEP_COLUMNS in
--     spotify-disconnect-registry.ts, this is catalog data shared
--     across users; not purged on individual disconnect.
--
-- New table:
--   user_spotify_skipped_artists — per-user list of Spotify artist
--     ids the user has dismissed from the Spotify-follow rail on
--     Discover. We don't suggest the same card twice once skipped.

ALTER TABLE "songs"
  ADD COLUMN "spotify_preview_url" text;
--> statement-breakpoint

CREATE TABLE "user_spotify_skipped_artists" (
	"user_id" text NOT NULL,
	"spotify_artist_id" text NOT NULL,
	"skipped_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_spotify_skipped_artists_pkey"
	  PRIMARY KEY ("user_id", "spotify_artist_id")
);
--> statement-breakpoint
ALTER TABLE "user_spotify_skipped_artists"
  ADD CONSTRAINT "user_spotify_skipped_artists_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
