-- For festival shows the Setlist tab picker lets the user switch
-- between the lineup's performers; each performer's predicted
-- setlist is rendered independently and "Open in Spotify" should
-- export that performer's songs. Before this migration the
-- `show_spotify_playlists` table was unique on
-- (show_id, user_id, kind), so it could only hold one playlist per
-- show / kind and the create path silently always used the
-- headliner's prediction. Add a `performer_id` column scoped to the
-- show's lineup and widen the unique index to include it.
--
-- Backfill: every pre-existing row was authored against the
-- headliner (the only code path that wrote into the table before
-- this change), so we attribute existing rows to the headliner's
-- performer_id. The lookup mirrors `pickHeadliner` in
-- `packages/shared/src/show-accessors.ts`: prefer
-- (role='headliner', sort_order=0), then any headliner, else the
-- first lineup row. Rows whose show has no lineup at all get
-- deleted — `loadShowContext` already rejected those at request
-- time, so no live playlist row could exist in that state.

ALTER TABLE "show_spotify_playlists"
  ADD COLUMN "performer_id" uuid;
--> statement-breakpoint
ALTER TABLE "show_spotify_playlists"
  ADD CONSTRAINT "show_spotify_playlists_performer_id_performers_id_fk"
  FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
UPDATE "show_spotify_playlists" ssp
SET "performer_id" = sub.performer_id
FROM (
  SELECT DISTINCT ON (sp."show_id")
    sp."show_id",
    sp."performer_id"
  FROM "show_performers" sp
  ORDER BY
    sp."show_id",
    CASE
      WHEN sp."role" = 'headliner' AND sp."sort_order" = 0 THEN 0
      WHEN sp."role" = 'headliner' THEN 1
      ELSE 2
    END,
    sp."sort_order"
) sub
WHERE ssp."show_id" = sub.show_id;
--> statement-breakpoint
DELETE FROM "show_spotify_playlists" WHERE "performer_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "show_spotify_playlists"
  ALTER COLUMN "performer_id" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "show_spotify_playlists_show_user_kind_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "show_spotify_playlists_show_user_kind_performer_idx"
  ON "show_spotify_playlists" USING btree
  ("show_id", "user_id", "kind", "performer_id");
