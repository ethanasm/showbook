-- Reshape `users` to NextAuth's expected schema and convert all `user_id`
-- columns from uuid to text. The original 0000 migration created `users` with
-- a custom shape (uuid id + NOT NULL google_id/display_name) that prevented
-- the NextAuth DrizzleAdapter from persisting Google sign-ins, so every user
-- collapsed onto the single seeded `test@showbook.dev` row. This migration is
-- destructive: it drops the existing `users` table. The dev DB is empty, so
-- no data preservation is needed.

ALTER TABLE "shows" DROP CONSTRAINT IF EXISTS "shows_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_venue_follows" DROP CONSTRAINT IF EXISTS "user_venue_follows_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_performer_follows" DROP CONSTRAINT IF EXISTS "user_performer_follows_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP CONSTRAINT IF EXISTS "user_preferences_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_regions" DROP CONSTRAINT IF EXISTS "user_regions_user_id_users_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "shows_user_state_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "shows_user_date_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "shows_user_kind_idx";--> statement-breakpoint
ALTER TABLE "user_venue_follows" DROP CONSTRAINT IF EXISTS "user_venue_follows_user_id_venue_id_pk";--> statement-breakpoint
ALTER TABLE "user_performer_follows" DROP CONSTRAINT IF EXISTS "user_performer_follows_user_id_performer_id_pk";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP CONSTRAINT IF EXISTS "user_preferences_pkey";--> statement-breakpoint
ALTER TABLE "shows" ALTER COLUMN "user_id" SET DATA TYPE text USING "user_id"::text;--> statement-breakpoint
ALTER TABLE "user_venue_follows" ALTER COLUMN "user_id" SET DATA TYPE text USING "user_id"::text;--> statement-breakpoint
ALTER TABLE "user_performer_follows" ALTER COLUMN "user_id" SET DATA TYPE text USING "user_id"::text;--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "user_id" SET DATA TYPE text USING "user_id"::text;--> statement-breakpoint
ALTER TABLE "user_regions" ALTER COLUMN "user_id" SET DATA TYPE text USING "user_id"::text;--> statement-breakpoint
ALTER TABLE "user_venue_follows" ADD CONSTRAINT "user_venue_follows_user_id_venue_id_pk" PRIMARY KEY ("user_id","venue_id");--> statement-breakpoint
ALTER TABLE "user_performer_follows" ADD CONSTRAINT "user_performer_follows_user_id_performer_id_pk" PRIMARY KEY ("user_id","performer_id");--> statement-breakpoint
ALTER TABLE "user_preferences" ADD PRIMARY KEY ("user_id");--> statement-breakpoint
DROP TABLE "users" CASCADE;--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_venue_follows" ADD CONSTRAINT "user_venue_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_performer_follows" ADD CONSTRAINT "user_performer_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_regions" ADD CONSTRAINT "user_regions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shows_user_state_idx" ON "shows" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "shows_user_date_idx" ON "shows" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "shows_user_kind_idx" ON "shows" USING btree ("user_id","kind");--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "ticket_count" integer DEFAULT 1 NOT NULL;
