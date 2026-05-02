-- Track performer IDs for support acts on announcements so that
-- followed-artist feeds include events where the artist is support,
-- not just headliner.
--
-- Replicates the cascade behavior already wired up for
-- headliner_performer_id (migrations 0014, 0022, 0023):
--
--   1. announcement_has_preserver:
--        rule 3 already preserves an announcement when the headliner
--        is followed; extend it so a followed *support* performer
--        also preserves the row.
--
--   2. cleanup_announcements_after_performer_unfollow:
--        when a user unfollows a performer, the trigger scans every
--        announcement where that performer was headliner. Extend it
--        to also scan announcements where that performer is in
--        support_performer_ids — those may now be orphans too.
--
--   3. cleanup_orphaned_performer:
--        before deleting a performer the trigger checks whether they
--        are still referenced as a headliner. Extend the check to
--        include support_performer_ids, and when an announcement is
--        deleted, attempt cleanup for every support performer (not
--        just the headliner).

ALTER TABLE "announcements"
  ADD COLUMN "support_performer_ids" uuid[];
--> statement-breakpoint

CREATE INDEX "announcements_support_performer_ids_idx"
  ON "announcements" USING GIN ("support_performer_ids");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION announcement_has_preserver(ann_id uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_venue_id uuid;
  v_performer_id uuid;
  v_support_ids uuid[];
  v_lat double precision;
  v_lng double precision;
BEGIN
  SELECT a.venue_id, a.headliner_performer_id, a.support_performer_ids, v.latitude, v.longitude
  INTO v_venue_id, v_performer_id, v_support_ids, v_lat, v_lng
  FROM announcements a
  JOIN venues v ON v.id = a.venue_id
  WHERE a.id = ann_id;

  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  -- 1. Linked to any show.
  IF EXISTS (SELECT 1 FROM show_announcement_links WHERE announcement_id = ann_id) THEN
    RETURN TRUE;
  END IF;

  -- 2. Venue followed by any user.
  IF EXISTS (SELECT 1 FROM user_venue_follows WHERE venue_id = v_venue_id) THEN
    RETURN TRUE;
  END IF;

  -- 3. Headliner followed by any user.
  IF v_performer_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM user_performer_follows WHERE performer_id = v_performer_id) THEN
    RETURN TRUE;
  END IF;

  -- 3b. Any support performer followed by any user.
  IF v_support_ids IS NOT NULL AND array_length(v_support_ids, 1) > 0
     AND EXISTS (
       SELECT 1 FROM user_performer_follows
       WHERE performer_id = ANY(v_support_ids)
     ) THEN
    RETURN TRUE;
  END IF;

  -- 4. Venue with no coords + any active region exists → preserve
  --    (matches isVenueInBbox's null-handling).
  IF v_lat IS NULL OR v_lng IS NULL THEN
    IF EXISTS (SELECT 1 FROM user_regions WHERE active = TRUE) THEN
      RETURN TRUE;
    END IF;
    RETURN FALSE;
  END IF;

  -- 5. Any active region's bbox contains the venue.
  IF EXISTS (
    SELECT 1
    FROM user_regions r
    WHERE r.active = TRUE
      AND cos(radians(r.latitude)) <> 0
      AND v_lat BETWEEN r.latitude - (r.radius_miles / 69.0)
                    AND r.latitude + (r.radius_miles / 69.0)
      AND v_lng BETWEEN r.longitude - (r.radius_miles / (69.0 * cos(radians(r.latitude))))
                    AND r.longitude + (r.radius_miles / (69.0 * cos(radians(r.latitude))))
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;
--> statement-breakpoint

-- Extend the unfollow-cleanup trigger to also walk announcements where
-- the unfollowed performer was a *support* act.
CREATE OR REPLACE FUNCTION cleanup_announcements_after_performer_unfollow() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ann_row record;
BEGIN
  FOR ann_row IN
    SELECT id FROM announcements
    WHERE headliner_performer_id = OLD.performer_id
       OR OLD.performer_id = ANY(support_performer_ids)
  LOOP
    IF NOT announcement_has_preserver(ann_row.id) THEN
      DELETE FROM announcements WHERE id = ann_row.id;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- The orphan-performer cleanup must (a) treat support_performer_ids as
-- a valid back-reference when deciding whether a performer is still
-- live, and (b) when an announcement is deleted, attempt cleanup for
-- every performer it referenced — headliner AND every support id.
CREATE OR REPLACE FUNCTION cleanup_orphaned_performer() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  candidate uuid;
  candidates uuid[];
BEGIN
  IF TG_TABLE_NAME = 'show_performers' THEN
    candidates := ARRAY[OLD.performer_id];
  ELSIF TG_TABLE_NAME = 'user_performer_follows' THEN
    candidates := ARRAY[OLD.performer_id];
  ELSIF TG_TABLE_NAME = 'announcements' THEN
    -- Headliner + every support performer needs a chance to be cleaned
    -- up; the announcement was the last reference for any of them.
    candidates := ARRAY[OLD.headliner_performer_id];
    IF OLD.support_performer_ids IS NOT NULL THEN
      candidates := candidates || OLD.support_performer_ids;
    END IF;
  ELSIF TG_TABLE_NAME = 'media_asset_performers' THEN
    candidates := ARRAY[OLD.performer_id];
  END IF;

  IF candidates IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH candidate IN ARRAY candidates LOOP
    IF candidate IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM show_performers WHERE performer_id = candidate)
       AND NOT EXISTS (SELECT 1 FROM user_performer_follows WHERE performer_id = candidate)
       AND NOT EXISTS (SELECT 1 FROM announcements WHERE headliner_performer_id = candidate)
       AND NOT EXISTS (SELECT 1 FROM announcements WHERE candidate = ANY(support_performer_ids))
       AND NOT EXISTS (SELECT 1 FROM media_asset_performers WHERE performer_id = candidate) THEN
      DELETE FROM performers WHERE id = candidate;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
