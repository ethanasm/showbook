-- Purge announcements that Ticketmaster ingest classified as 'unknown' —
-- attractions whose TM payload had no usable segment id (the High Roller
-- Wheel at the LINQ, parking-pass listings, suite-deposit rows, etc.).
-- The discover-ingest normalizer now drops these at the source so the
-- bucket stops refilling; this one-shot wipes the rows already persisted.
--
-- show_announcement_links.announcement_id is ON DELETE CASCADE (see
-- 0006_announcement_link_cascade.sql), so any link rows fall away with
-- the announcement and any user-created shows that referenced these
-- announcements are left intact.
DELETE FROM "announcements"
WHERE "kind" = 'unknown';
