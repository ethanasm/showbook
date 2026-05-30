-- Remove the 'sports' show kind entirely. The kind was added in
-- 0007_add_sports_kind.sql; it's now being dropped from the product.
--
-- Per the product decision, shows and announcements carrying kind='sports'
-- are DELETED (not reclassified). show_announcement_links.announcement_id is
-- ON DELETE CASCADE (0006_announcement_link_cascade.sql), so link rows fall
-- away with their announcement.
--
-- Compares via ::text rather than the enum literal so the statement is safe
-- to run in the same transaction batch that introduced 'sports' on a fresh
-- E2E DB (Postgres rejects un-committed enum values used as literals; a text
-- cast sidesteps the check) — same pattern as 0054_drop_unknown_announcements.
DELETE FROM "announcements" WHERE "kind"::text = 'sports';
DELETE FROM "shows" WHERE "kind"::text = 'sports';

-- Postgres can't drop a value from an enum in place, so recreate the type
-- without 'sports' and swap both columns over to it. Neither shows.kind nor
-- announcements.kind has a DEFAULT bound to the enum, so no default juggling
-- is required.
ALTER TYPE "kind" RENAME TO "kind_old";
CREATE TYPE "kind" AS ENUM('concert', 'theatre', 'comedy', 'festival', 'film', 'unknown');
ALTER TABLE "shows" ALTER COLUMN "kind" TYPE "kind" USING "kind"::text::"kind";
ALTER TABLE "announcements" ALTER COLUMN "kind" TYPE "kind" USING "kind"::text::"kind";
DROP TYPE "kind_old";
