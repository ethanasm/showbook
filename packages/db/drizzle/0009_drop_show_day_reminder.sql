ALTER TYPE "public"."kind" ADD VALUE IF NOT EXISTS 'sports';--> statement-breakpoint
ALTER TABLE "show_announcement_links" DROP CONSTRAINT "show_announcement_links_announcement_id_announcements_id_fk";
--> statement-breakpoint
ALTER TABLE "show_announcement_links" ADD CONSTRAINT "show_announcement_links_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" DROP COLUMN "show_day_reminder";
