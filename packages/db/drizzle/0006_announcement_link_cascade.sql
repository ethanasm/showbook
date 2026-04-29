-- Add ON DELETE CASCADE to show_announcement_links.announcement_id so that
-- deleting an announcement also removes the join rows. Symmetric with the
-- existing cascade on show_announcement_links.show_id, and unblocks the
-- /api/test/seed flow which wipes announcements globally.

ALTER TABLE "show_announcement_links"
  DROP CONSTRAINT "show_announcement_links_announcement_id_announcements_id_fk";
--> statement-breakpoint
ALTER TABLE "show_announcement_links"
  ADD CONSTRAINT "show_announcement_links_announcement_id_announcements_id_fk"
  FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
