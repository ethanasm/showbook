-- Consolidate email digest preferences.
-- The hourly per-user digest with custom send time and frequency is replaced
-- by a single global daily digest at 08:00 ET. emailNotifications becomes the
-- only on/off switch; per-user lastDigestSentAt tracks "what counts as new"
-- for the announcements section.

ALTER TABLE "user_preferences" ADD COLUMN "last_digest_sent_at" timestamptz;--> statement-breakpoint
ALTER TABLE "user_preferences" DROP COLUMN "digest_frequency";--> statement-breakpoint
ALTER TABLE "user_preferences" DROP COLUMN "digest_time";--> statement-breakpoint
DROP TYPE "public"."digest_frequency";--> statement-breakpoint

-- Clean up stale pg-boss schedules so registerAllJobs starts from a known state.
DELETE FROM pgboss.schedule WHERE name IN ('notifications/digest', 'notifications/weekly-digest');
