-- Per-user snapshot of the daily digest's "new for you" announcements,
-- surfaced as the Discover "New for you" tab.
--
-- `runDailyDigest` (packages/jobs/src/notifications.ts) computes each user's
-- bucketed announcement set and persists it here replace-on-write: it deletes
-- the user's rows and re-inserts the fresh set every run, regardless of the
-- `email_notifications` preference (that setting now gates only the email).
-- The `discover.digestFeed` tRPC query reads it back, joining to the live
-- announcements/venues/performers rows, so detail edits stay fresh and pruned
-- announcements drop out via the inner join (ON DELETE cascade also clears the
-- entry). Both FKs cascade. The composite PK (user_id, announcement_id) is the
-- uniqueness guarantee + cheap delete key; the (user_id, position) index serves
-- the ordered read.
--
-- `user_preferences.last_digest_computed_at` is the per-everyone snapshot
-- idempotency guard (distinct from email's `last_digest_sent_at`): it advances
-- once the day's snapshot is persisted so a pg-boss retry mid-run can't wipe a
-- snapshot that was already built, and it drives the per-user "new since" cutoff.
CREATE TYPE "public"."digest_reason" AS ENUM('venue', 'artist', 'region');--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "last_digest_computed_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "user_digest_entries" (
	"user_id" text NOT NULL,
	"announcement_id" uuid NOT NULL,
	"reason" "digest_reason" NOT NULL,
	"on_sale_soon" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "user_digest_entries_user_id_announcement_id_pk" PRIMARY KEY("user_id","announcement_id")
);
--> statement-breakpoint
ALTER TABLE "user_digest_entries" ADD CONSTRAINT "user_digest_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_digest_entries" ADD CONSTRAINT "user_digest_entries_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_digest_entries_user_position_idx" ON "user_digest_entries" USING btree ("user_id","position");
