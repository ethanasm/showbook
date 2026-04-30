-- Functional indexes for the case-insensitive name lookups used by
-- matchOrCreatePerformer (performer-matcher.ts) and matchOrCreateVenue
-- (venue-matcher.ts). The plain b-tree on (name) added in 0017 doesn't
-- help `lower(name) = lower($1)` queries.

CREATE INDEX IF NOT EXISTS "performers_lower_name_idx"
  ON "performers" (LOWER("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venues_lower_name_city_idx"
  ON "venues" (LOWER("name"), LOWER("city"));
