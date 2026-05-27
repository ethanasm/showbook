-- Null out Ticketmaster resale-marketplace URLs that snuck into
-- `ticket_url` via the un-filtered `events[0]?.url` path. These are the
-- bare `https://www.ticketmaster.com/event/<id>` form (no slug between
-- host and `/event/`) — they render "Page Not Found" in the browser
-- because TM only honours that shortlink inside the resale flow.
--
-- After this migration:
--   * `apps/web/.../shows.ts`, `backfill-show-ticket-urls.ts`, and
--     `discover-ingest.ts` filter via `pickPrimaryEventUrl` /
--     `isPrimaryEventUrl`, so newly-written `ticket_url` values can't
--     regress to the resale variant.
--   * `shows.ticket_url` rows nulled here get re-populated by the
--     daily 06:45 ET `backfill-show-ticket-urls` cron the next morning
--     using the primary-sale URL (when TM has one).
--   * `announcements.ticket_url` rows nulled here get re-populated when
--     the per-venue / per-region discover-ingest jobs refresh them via
--     `refreshExistingFromTmEvent`.
UPDATE "shows"
SET "ticket_url" = NULL
WHERE "ticket_url" ~ '^https?://[^/]+/event/[^/]+/?$';

UPDATE "announcements"
SET "ticket_url" = NULL
WHERE "ticket_url" ~ '^https?://[^/]+/event/[^/]+/?$';
