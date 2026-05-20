-- Adds a `presale` value to the on_sale_status enum so Discover rows can
-- distinguish "currently in presale" from "sold out" — the Ticketmaster
-- Discovery API emits dates.status.code='offsale' during the presale-only
-- period (because the *public* sale hasn't opened yet), which the ingest
-- normalizer used to read verbatim as sold_out. See determineOnSaleStatus
-- in packages/jobs/src/discover-ingest.ts.
ALTER TYPE "public"."on_sale_status" ADD VALUE IF NOT EXISTS 'presale';
