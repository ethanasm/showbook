-- Phase 3 of setlist-intelligence — per-(show, user, kind) record of
-- Spotify playlists Showbook has created. `kind` distinguishes the
-- pre-show "hype" playlist (predicted setlist) from the post-show
-- "heard" playlist (actual setlist). The unique index gives the
-- idempotency contract: re-tapping the playlist button returns the
-- existing row instead of creating a duplicate playlist.
--
-- See specs/setlist-intelligence/phases/phase-03-spotify-export.md.

CREATE TABLE "show_spotify_playlists" (
	"show_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"playlist_id" text NOT NULL,
	"spotify_url" text NOT NULL,
	"track_count" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "show_spotify_playlists" ADD CONSTRAINT "show_spotify_playlists_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "show_spotify_playlists" ADD CONSTRAINT "show_spotify_playlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "show_spotify_playlists_show_user_kind_idx" ON "show_spotify_playlists" USING btree ("show_id","user_id","kind");
