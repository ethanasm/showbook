-- Per-user manual ticket-status override on a saved show.
--
-- The Ticketmaster Discovery API surfaces sold-out / cancelled via
-- dates.status.code (offsale / canceled), but that signal only lands on the
-- announcements (public discovery feed) as on_sale_status — never on the
-- per-user `shows` row the detail page reads, and TM barely covers the small
-- TicketWeb-primary venues where this matters most. This column lets a user
-- mark their own show as sold out or cancelled by hand.
--
-- New enum + column:
--   ticket_status — { sold_out, cancelled }. Distinct from the
--     announcements-side on_sale_status enum (which is TM-derived and has a
--     full lifecycle: announced / presale / on_sale / sold_out / cancelled).
--   shows.ticket_status — nullable; NULL means "no override" (the normal
--     case). The two values are mutually exclusive and orthogonal to
--     shows.state (a past show can have been cancelled, a watching show can
--     be sold out).
CREATE TYPE "public"."ticket_status" AS ENUM('sold_out', 'cancelled');
--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "ticket_status" "ticket_status";
