-- Track Ticketmaster event IDs that were collapsed into a single
-- announcement during ingest dedup (see dedupeTierVariants in
-- packages/jobs/src/discover-ingest.ts). These IDs must be loaded
-- alongside source_event_id when computing the existing-source-id
-- set so re-ingest stays idempotent and doesn't recreate a tier
-- variant that was previously dropped.

ALTER TABLE "announcements"
  ADD COLUMN "extra_source_event_ids" text[];
