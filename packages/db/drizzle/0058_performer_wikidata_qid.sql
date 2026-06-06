-- Theatre cast members via Wikidata.
--
-- Theatre cast (Broadway / regional actors) mostly have no Ticketmaster
-- attraction page, so the existing TM-keyed enrichment never fires for
-- them. Wikidata is the enrichment source instead: a person's QID is the
-- stable external id, P18 gives a headshot, and P434 gives a MusicBrainz
-- id when the actor is also a recording/concert artist.
--
-- New column:
--   performers.wikidata_qid — Wikidata QID (e.g. "Q40281836"). Populated
--     by the fire-and-forget `resolvePerformerWikidataId` hook in
--     matchOrCreatePerformer for cast entered via the theatre typeahead /
--     playbill extraction, and by the `backfill-performer-wikidata-ids`
--     cron + admin button. Partial-UNIQUE so a single QID maps to exactly
--     one performer row; the resolver's catch(isUniqueViolation) branch
--     relies on this index to leave a row null when another row already
--     owns the QID (duplicate-performer cleanup is an operator merge).

ALTER TABLE "performers"
  ADD COLUMN "wikidata_qid" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "performers_wikidata_uniq"
  ON "performers" ("wikidata_qid")
  WHERE "wikidata_qid" IS NOT NULL;
