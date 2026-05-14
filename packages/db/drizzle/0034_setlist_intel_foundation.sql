-- Phase 0 of the setlist-intelligence feature. Schema foundation for the
-- predicted-setlist algorithm + per-song stats. See
-- showbook-specs/setlist-intelligence/phases/phase-00-foundation.md.
--
-- New tables:
--   tour_setlists              — corpus of setlist.fm setlists per artist
--   songs                      — first-class song entity (per performer)
--   setlist_song_appearances   — denormalized index of every song-in-a-setlist
--   prediction_cache           — cache of predictSetlist outputs
--   prediction_eval_runs       — back-test eval harness output (Phase 4)
--
-- New matview:
--   user_song_stats            — per-(user, song) times-heard / first / last
--
-- Extends existing tables:
--   performers — adds setlist_style + setlist_style_inferred_at (Phase 5)

CREATE TABLE "tour_setlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performer_id" uuid NOT NULL,
	"tour_id" text,
	"tour_name" text,
	"tour_leg" text,
	"performance_date" date NOT NULL,
	"venue_name_raw" text,
	"city" text,
	"country_code" text,
	"setlistfm_id" text NOT NULL,
	"setlist" jsonb NOT NULL,
	"song_count" smallint NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tour_setlists" ADD CONSTRAINT "tour_setlists_performer_id_performers_id_fk" FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "tour_setlists_setlistfm_unique" ON "tour_setlists" USING btree ("setlistfm_id");
--> statement-breakpoint
CREATE INDEX "tour_setlists_performer_date_idx" ON "tour_setlists" USING btree ("performer_id","performance_date" DESC);
--> statement-breakpoint
CREATE INDEX "tour_setlists_performer_tour_idx" ON "tour_setlists" USING btree ("performer_id","tour_id","performance_date" DESC);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"cover_of" text,
	"spotify_track_id" text,
	"duration_ms" integer,
	"first_known_performance" date,
	"historical_play_count" integer DEFAULT 0 NOT NULL,
	"historical_mean_gap" real,
	"last_played_date" date,
	"current_gap_shows" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_performer_id_performers_id_fk" FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "songs_performer_title_idx" ON "songs" USING btree ("performer_id", LOWER("title"));
--> statement-breakpoint
CREATE INDEX "songs_spotify_idx" ON "songs" USING btree ("spotify_track_id") WHERE "spotify_track_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "songs_overdue_idx" ON "songs" USING btree ("performer_id","current_gap_shows" DESC) WHERE "historical_play_count" >= 3;
--> statement-breakpoint
CREATE TABLE "setlist_song_appearances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"song_id" uuid NOT NULL,
	"performer_id" uuid NOT NULL,
	"performance_date" date NOT NULL,
	"show_id" uuid,
	"tour_setlist_id" uuid,
	"section_index" smallint NOT NULL,
	"song_index" smallint NOT NULL,
	"is_encore" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'core' NOT NULL,
	"tour_id" text,
	"tour_name" text
);
--> statement-breakpoint
ALTER TABLE "setlist_song_appearances" ADD CONSTRAINT "setlist_song_appearances_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "setlist_song_appearances" ADD CONSTRAINT "setlist_song_appearances_performer_id_performers_id_fk" FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "setlist_song_appearances" ADD CONSTRAINT "setlist_song_appearances_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "setlist_song_appearances" ADD CONSTRAINT "setlist_song_appearances_tour_setlist_id_tour_setlists_id_fk" FOREIGN KEY ("tour_setlist_id") REFERENCES "public"."tour_setlists"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "appearances_song_date_idx" ON "setlist_song_appearances" USING btree ("song_id","performance_date" DESC);
--> statement-breakpoint
CREATE INDEX "appearances_performer_date_idx" ON "setlist_song_appearances" USING btree ("performer_id","performance_date" DESC);
--> statement-breakpoint
CREATE INDEX "appearances_show_idx" ON "setlist_song_appearances" USING btree ("show_id") WHERE "show_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "appearances_performer_tour_date_idx" ON "setlist_song_appearances" USING btree ("performer_id","tour_id","performance_date" DESC);
--> statement-breakpoint
CREATE TABLE "prediction_cache" (
	"performer_id" uuid NOT NULL,
	"target_date" date NOT NULL,
	"corpus_signature" text NOT NULL,
	"prediction_json" jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_cache_performer_id_target_date_pk" PRIMARY KEY("performer_id","target_date")
);
--> statement-breakpoint
ALTER TABLE "prediction_cache" ADD CONSTRAINT "prediction_cache_performer_id_performers_id_fk" FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "prediction_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ran_at" timestamp DEFAULT now() NOT NULL,
	"predictions" integer NOT NULL,
	"brier_score" real NOT NULL,
	"calibration_curve" jsonb NOT NULL,
	"precision_top10" real NOT NULL,
	"recall_top10" real NOT NULL,
	"by_style" jsonb NOT NULL
);
--> statement-breakpoint
CREATE MATERIALIZED VIEW "user_song_stats" AS
	SELECT
		s.user_id,
		a.song_id,
		a.performer_id,
		COUNT(*)::integer AS times_heard,
		MIN(a.performance_date) AS first_heard,
		MAX(a.performance_date) AS last_heard
	FROM setlist_song_appearances a
	JOIN shows s ON s.id = a.show_id
	GROUP BY s.user_id, a.song_id, a.performer_id;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_song_stats_pk" ON "user_song_stats" ("user_id","song_id","performer_id");
--> statement-breakpoint
CREATE INDEX "user_song_stats_user_count_idx" ON "user_song_stats" ("user_id","times_heard" DESC);
--> statement-breakpoint
ALTER TABLE "performers" ADD COLUMN "setlist_style" text;
--> statement-breakpoint
ALTER TABLE "performers" ADD COLUMN "setlist_style_inferred_at" timestamp;
