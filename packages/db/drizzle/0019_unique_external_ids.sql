-- Partial UNIQUE indexes on external IDs. These IDs come from authoritative
-- sources (Ticketmaster, MusicBrainz, Google Places) and a single id should
-- only ever map to one row. Concurrent ingests previously could create
-- duplicates because the matcher does SELECT-then-INSERT.
--
-- Partial WHERE … IS NOT NULL keeps the constraint from forcing every row
-- to fill the column.

CREATE UNIQUE INDEX IF NOT EXISTS "performers_tm_attraction_uniq"
  ON "performers" ("ticketmaster_attraction_id")
  WHERE "ticketmaster_attraction_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "performers_musicbrainz_uniq"
  ON "performers" ("musicbrainz_id")
  WHERE "musicbrainz_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "venues_tm_venue_uniq"
  ON "venues" ("ticketmaster_venue_id")
  WHERE "ticketmaster_venue_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "venues_google_place_uniq"
  ON "venues" ("google_place_id")
  WHERE "google_place_id" IS NOT NULL;
