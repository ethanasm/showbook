-- Adds a `cancelled` value to the on_sale_status enum so Discover rows can
-- distinguish a show that was called off from one that simply sold out. The
-- Ticketmaster Discovery API surfaces this as dates.status.code='canceled'
-- (American spelling; we accept 'cancelled' defensively). Previously the
-- ingest normalizer collapsed cancelled events into sold_out, which is how a
-- cancelled tour (e.g. Meghan Trainor at Chase Center) showed up labelled
-- "SOLD OUT". See determineOnSaleStatus in packages/jobs/src/on-sale-status.ts.
ALTER TYPE "public"."on_sale_status" ADD VALUE IF NOT EXISTS 'cancelled';
