-- One-shot cleanup of past-dated announcements that piled up before
-- the prune/past-announcements cron existed. Going forward, the cron
-- at 02:00 ET runs this same DELETE daily so the Discover Venues,
-- Artists, and Regions feeds never have past shows to surface.
--
-- show_announcement_links.announcement_id is ON DELETE CASCADE, so
-- this drops the link rows but leaves any user-added `shows` row
-- (created from one of these announcements) intact.
DELETE FROM "announcements"
WHERE "show_date" < CURRENT_DATE;
