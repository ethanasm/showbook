-- Festival singles created before the headliner-normalize fix appear as one
-- announcement per day at the same venue (e.g., Outside Lands showed up as 3
-- rows for Aug 7 / 8 / 9). normalizeTmEvent now pins festival headliner to a
-- stable festival name so groupEventsIntoRuns collapses them into a single
-- multi-day run on re-ingest, but only NEW TM events flow through that path —
-- existing rows are skipped via existingSourceIds. Clear the broken singles
-- so the next discover-ingest pass rewrites them correctly.
--
-- Scope kept tight: only TM-sourced festival rows with a sibling festival
-- within ±14 days at the same venue, still in the future, and not already
-- linked to a user Show. A correctly grouped run has no same-venue sibling
-- inside its own date window once the row is gone (the merge already covers
-- it), so the migration is idempotent.
DELETE FROM "announcements" a
WHERE a."source" = 'ticketmaster'
  AND a."kind" = 'festival'
  AND a."source_event_id" IS NOT NULL
  AND a."show_date" >= CURRENT_DATE
  AND NOT EXISTS (
    SELECT 1 FROM "show_announcement_links" sal
    WHERE sal."announcement_id" = a."id"
  )
  AND EXISTS (
    SELECT 1 FROM "announcements" b
    WHERE b."id" <> a."id"
      AND b."source" = 'ticketmaster'
      AND b."kind" = 'festival'
      AND b."venue_id" = a."venue_id"
      AND b."show_date" BETWEEN a."show_date" - INTERVAL '14 days'
                            AND a."show_date" + INTERVAL '14 days'
  );
