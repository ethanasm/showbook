CREATE TYPE "public"."announcement_source" AS ENUM('ticketmaster', 'manual');--> statement-breakpoint
CREATE TYPE "public"."on_sale_status" AS ENUM('announced', 'on_sale', 'sold_out');--> statement-breakpoint
CREATE TYPE "public"."enrichment_type" AS ENUM('setlist');--> statement-breakpoint
CREATE TYPE "public"."kind" AS ENUM('concert', 'theatre', 'comedy', 'festival');--> statement-breakpoint
CREATE TYPE "public"."performer_role" AS ENUM('headliner', 'support', 'cast');--> statement-breakpoint
CREATE TYPE "public"."state" AS ENUM('past', 'ticketed', 'watching');--> statement-breakpoint
CREATE TYPE "public"."digest_frequency" AS ENUM('daily', 'weekly', 'off');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"kind" "kind" NOT NULL,
	"headliner" text NOT NULL,
	"headliner_performer_id" uuid,
	"support" text[],
	"show_date" date NOT NULL,
	"on_sale_date" timestamp,
	"on_sale_status" "on_sale_status" NOT NULL,
	"source" "announcement_source" NOT NULL,
	"source_event_id" text,
	"discovered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "show_announcement_links" (
	"show_id" uuid NOT NULL,
	"announcement_id" uuid NOT NULL,
	CONSTRAINT "show_announcement_links_show_id_announcement_id_pk" PRIMARY KEY("show_id","announcement_id")
);
--> statement-breakpoint
CREATE TABLE "enrichment_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"type" "enrichment_type" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 14 NOT NULL,
	"next_retry" timestamp NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_performer_follows" (
	"user_id" uuid NOT NULL,
	"performer_id" uuid NOT NULL,
	"followed_at" timestamp DEFAULT now(),
	CONSTRAINT "user_performer_follows_user_id_performer_id_pk" PRIMARY KEY("user_id","performer_id")
);
--> statement-breakpoint
CREATE TABLE "user_venue_follows" (
	"user_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"followed_at" timestamp DEFAULT now(),
	CONSTRAINT "user_venue_follows_user_id_venue_id_pk" PRIMARY KEY("user_id","venue_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"neighborhood" text,
	"city" text NOT NULL,
	"state_region" text,
	"country" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"ticketmaster_venue_id" text,
	"google_place_id" text,
	"scrape_config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"setlistfm_mbid" text,
	"ticketmaster_attraction_id" text,
	"image_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "show_performers" (
	"show_id" uuid NOT NULL,
	"performer_id" uuid NOT NULL,
	"role" "performer_role" NOT NULL,
	"character_name" text,
	"sort_order" integer NOT NULL,
	CONSTRAINT "show_performers_show_id_performer_id_role_pk" PRIMARY KEY("show_id","performer_id","role")
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "kind" NOT NULL,
	"state" "state" NOT NULL,
	"venue_id" uuid NOT NULL,
	"date" date NOT NULL,
	"end_date" date,
	"seat" text,
	"price_paid" numeric(10, 2),
	"tour_name" text,
	"setlist" text[],
	"photos" text[],
	"source_refs" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"city_name" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"radius_miles" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" "theme" DEFAULT 'system',
	"compact_mode" boolean DEFAULT false,
	"digest_frequency" "digest_frequency" DEFAULT 'daily',
	"digest_time" time DEFAULT '08:00',
	"email_notifications" boolean DEFAULT true,
	"push_notifications" boolean DEFAULT true,
	"show_day_reminder" boolean DEFAULT true
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_headliner_performer_id_performers_id_fk" FOREIGN KEY ("headliner_performer_id") REFERENCES "public"."performers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_announcement_links" ADD CONSTRAINT "show_announcement_links_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_announcement_links" ADD CONSTRAINT "show_announcement_links_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_queue" ADD CONSTRAINT "enrichment_queue_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_performer_follows" ADD CONSTRAINT "user_performer_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_performer_follows" ADD CONSTRAINT "user_performer_follows_performer_id_performers_id_fk" FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_venue_follows" ADD CONSTRAINT "user_venue_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_venue_follows" ADD CONSTRAINT "user_venue_follows_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_performers" ADD CONSTRAINT "show_performers_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_performers" ADD CONSTRAINT "show_performers_performer_id_performers_id_fk" FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_regions" ADD CONSTRAINT "user_regions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shows_user_state_idx" ON "shows" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "shows_user_date_idx" ON "shows" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "shows_user_kind_idx" ON "shows" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "shows_venue_idx" ON "shows" USING btree ("venue_id");