-- Add indexes on hot lookup columns identified during the audit.
-- All non-unique to avoid breaking existing rows that may contain duplicates.

CREATE INDEX IF NOT EXISTS "announcements_headliner_idx"
  ON "announcements" ("headliner_performer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_show_date_idx"
  ON "announcements" ("show_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_venue_date_idx"
  ON "announcements" ("venue_id", "show_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_regions_user_active_idx"
  ON "user_regions" ("user_id", "active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venues_tm_venue_id_idx"
  ON "venues" ("ticketmaster_venue_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venues_google_place_id_idx"
  ON "venues" ("google_place_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venues_name_city_idx"
  ON "venues" ("name", "city");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performers_tm_attraction_id_idx"
  ON "performers" ("ticketmaster_attraction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performers_musicbrainz_id_idx"
  ON "performers" ("musicbrainz_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performers_name_idx"
  ON "performers" ("name");
