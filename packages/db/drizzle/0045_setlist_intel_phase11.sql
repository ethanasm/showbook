-- Phase 11 of setlist-intelligence — polish (§15 shortlist items 4-10).
-- See specs/setlist-intelligence/phases/phase-11-polish.md.
--
-- Adds:
--   albums                  — canonical release-date catalog populated by
--                             the album-metadata-fill cron (02:30 ET nightly).
--                             Used by the §15m album-drop forward signal:
--                             when target date is within ±60 days of a
--                             release, predictSetlist synthesizes Tier-A
--                             appearances for the new-album tracks.
--   special_event_rules     — operator/auto-detected rules that short-
--                             circuit the prediction algorithm and route
--                             to a special-event empty state (§15g). The
--                             0044 seed inserts the canonical Phish
--                             Halloween rule.
--   user_preferences.setlist_spoilers (+ enum)
--                           — three-state user preference governing the
--                             spoiler curtain across the predicted-
--                             setlist tab AND the digest tile (§15o).
--   performers.spotify_artist_id
--                           — used by album-metadata-fill to call
--                             Spotify's /v1/artists/{id}/albums catalog
--                             endpoint. Backfilled lazily by the cron
--                             via search.
--   performers.last_watch_refresh_at
--                           — dedup for the setlist-tour-watch cron
--                             (§15l). 21h window prevents the every-3h
--                             cron from re-firing within the same day
--                             and respects setlist.fm rate limits.

CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performer_id" uuid NOT NULL,
	"spotify_album_id" text NOT NULL,
	"name" text NOT NULL,
	"release_date" date NOT NULL,
	"album_type" text,
	"track_ids" text[] NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "albums"
  ADD CONSTRAINT "albums_performer_id_performers_id_fk"
  FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "albums_spotify_unique"
  ON "albums" USING btree ("spotify_album_id");
--> statement-breakpoint
CREATE INDEX "albums_performer_release_idx"
  ON "albums" USING btree ("performer_id", "release_date" DESC);
--> statement-breakpoint

CREATE TABLE "special_event_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performer_id" uuid NOT NULL,
	"rule_kind" text NOT NULL,
	"pattern" jsonb NOT NULL,
	"effect" jsonb NOT NULL,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "special_event_rules"
  ADD CONSTRAINT "special_event_rules_performer_id_performers_id_fk"
  FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "special_event_rules_performer_active_idx"
  ON "special_event_rules" USING btree ("performer_id")
  WHERE "active" = true;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "setlist_spoilers_pref" AS ENUM ('always_blur', 'never_blur', 'style_default');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "user_preferences"
  ADD COLUMN "setlist_spoilers" "setlist_spoilers_pref" DEFAULT 'style_default';
--> statement-breakpoint

ALTER TABLE "performers"
  ADD COLUMN "spotify_artist_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "performers_spotify_artist_uniq"
  ON "performers" ("spotify_artist_id")
  WHERE "spotify_artist_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "performers"
  ADD COLUMN "last_watch_refresh_at" timestamp;
--> statement-breakpoint

-- Seed: Phish Halloween rule. effect.copy is the verbatim §15g
-- empty-state string from feature-plan.md. The INSERT falls
-- through silently if the Phish performer row doesn't exist yet
-- (fresh dev DBs); the operator can re-seed via the /admin/eval UI
-- once Phish is in `performers`.
INSERT INTO "special_event_rules" ("performer_id", "rule_kind", "pattern", "effect", "source")
SELECT
  "id",
  'date_match',
  '{"month":10,"day":31}'::jsonb,
  '{"copy":"Halloween is when Phish plays a full album in costume. We won''t predict this one — but here''s what they did on the last 5 Halloweens.","sampleCount":5}'::jsonb,
  'auto'
FROM "performers"
WHERE "musicbrainz_id" = 'e01646f2-2a04-450d-8bf2-0d0082d1c2c8'
ON CONFLICT DO NOTHING;
