-- Per-artist scope for the setlist enrichment queue.
--
-- Festivals are stored as a single shows row (kind='festival') with N
-- show_performers rows. The previous queue model — one row per show —
-- meant the setlist-retry job only ever looked up the role='headliner'
-- performer, silently dropping every other lineup artist on the floor.
-- shows.create and shows-nightly also gated their enqueue paths on
-- kind='concert', so festival artists never entered the pipeline at
-- all.
--
-- Adding performer_id to the queue lets us enqueue one row per
-- (show, performer) pair: each artist gets an independent 14-attempt
-- budget and the setlist-retry job knows exactly which performer to
-- fetch.

ALTER TABLE "enrichment_queue"
  ADD COLUMN "performer_id" uuid;
--> statement-breakpoint

-- Backfill existing rows to point at the show's headliner. Every
-- pre-migration row was implicitly the headliner because that's the
-- only role the retry job ever processed.
UPDATE "enrichment_queue" eq
SET "performer_id" = sp.performer_id
FROM "show_performers" sp
WHERE sp.show_id = eq.show_id
  AND sp.role = 'headliner'
  AND eq.performer_id IS NULL;
--> statement-breakpoint

-- Anything we couldn't backfill (no headliner row exists) is
-- unprocessable — the retry job would have failed every attempt
-- anyway. Drop before tightening the NOT NULL constraint.
DELETE FROM "enrichment_queue" WHERE "performer_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "enrichment_queue"
  ALTER COLUMN "performer_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "enrichment_queue"
  ADD CONSTRAINT "enrichment_queue_performer_id_performers_id_fk"
  FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE UNIQUE INDEX "enrichment_queue_show_performer_type_uq"
  ON "enrichment_queue" ("show_id", "performer_id", "type");
