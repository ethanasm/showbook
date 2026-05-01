-- Cascade-clean orphaned announcements at the DB layer.
--
-- Announcements have no FK to users, by design — they're shared
-- discovery rows. The app already prunes them in the venue.unfollow
-- and removeRegion tRPC mutations, but anything that bypasses tRPC
-- (direct user delete in prod, future maintenance scripts, etc.) left
-- them dangling. Migration 0022 made `DELETE FROM users` succeed but
-- the announcements piled up because no trigger ever decided they
-- were orphaned.
--
-- An announcement is preserved as long as ANY of the following
-- references it:
--   1. A show_announcement_link row (some user's show points at it).
--   2. A user_venue_follows row at the announcement's venue.
--   3. A user_performer_follows row on the announcement's headliner
--      (when headliner_performer_id is non-null).
--   4. An active user_regions row whose lat/lng bbox contains the
--      venue's coordinates (matches isVenueInBbox in preferences.ts).
-- A venue without latitude/longitude is conservatively preserved on
-- the bbox check — we can't tell if a region would catch it. Same
-- choice the app code makes.
--
-- One trigger fires per source table so deletes through any path
-- (cascades, app mutations, ad-hoc SQL) get the same treatment. The
-- existing cleanup_orphaned_venue / cleanup_orphaned_performer
-- triggers chain off the announcement DELETE, so removing an
-- orphaned announcement also lets its venue/performer go.
--
-- The DO block at the bottom is a one-time backfill: any
-- already-orphaned announcement (e.g. from the prod incident that
-- prompted this migration) is removed when the migration runs.

CREATE OR REPLACE FUNCTION announcement_has_preserver(ann_id uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_venue_id uuid;
  v_performer_id uuid;
  v_lat double precision;
  v_lng double precision;
BEGIN
  SELECT a.venue_id, a.headliner_performer_id, v.latitude, v.longitude
  INTO v_venue_id, v_performer_id, v_lat, v_lng
  FROM announcements a
  JOIN venues v ON v.id = a.venue_id
  WHERE a.id = ann_id;

  IF NOT FOUND THEN
    -- Already gone (e.g. another trigger removed it). Nothing to do.
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

  -- 4. Venue has no coordinates. The app code conservatively keeps
  --    these because it can't tell whether a region would catch them
  --    (preferences.ts isVenueInBbox returns false for null coords).
  --    Match that — but only when at least one active region exists
  --    to be ambiguous about. With zero active regions, the
  --    ambiguity is moot and the announcement is genuinely orphaned.
  IF v_lat IS NULL OR v_lng IS NULL THEN
    IF EXISTS (SELECT 1 FROM user_regions WHERE active = TRUE) THEN
      RETURN TRUE;
    END IF;
    RETURN FALSE;
  END IF;

  -- 5. Any active region's bbox contains the venue. Lat delta is
  -- radius/69; lng delta scales by cos(lat) to compensate for
  -- meridian convergence. Mirrors isVenueInBbox in preferences.ts.
  -- cos() of a region exactly at the pole would be 0; guard against
  -- it so we don't divide by zero (and just skip that region).
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

-- Trigger: a show link was removed. Check just that announcement.
CREATE OR REPLACE FUNCTION cleanup_announcement_after_show_link_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT announcement_has_preserver(OLD.announcement_id) THEN
    DELETE FROM announcements WHERE id = OLD.announcement_id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER cleanup_announcement_after_show_link_delete
AFTER DELETE ON show_announcement_links
FOR EACH ROW
EXECUTE FUNCTION cleanup_announcement_after_show_link_delete();
--> statement-breakpoint

-- Trigger: a venue follow was removed. Check every announcement at
-- that venue (the unfollowed user might have been the only thing
-- preserving them).
CREATE OR REPLACE FUNCTION cleanup_announcements_after_venue_unfollow() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ann_row record;
BEGIN
  FOR ann_row IN
    SELECT id FROM announcements WHERE venue_id = OLD.venue_id
  LOOP
    IF NOT announcement_has_preserver(ann_row.id) THEN
      DELETE FROM announcements WHERE id = ann_row.id;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER cleanup_announcements_after_user_venue_follows_delete
AFTER DELETE ON user_venue_follows
FOR EACH ROW
EXECUTE FUNCTION cleanup_announcements_after_venue_unfollow();
--> statement-breakpoint

-- Trigger: a performer follow was removed. Check announcements whose
-- headliner is that performer.
CREATE OR REPLACE FUNCTION cleanup_announcements_after_performer_unfollow() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ann_row record;
BEGIN
  FOR ann_row IN
    SELECT id FROM announcements WHERE headliner_performer_id = OLD.performer_id
  LOOP
    IF NOT announcement_has_preserver(ann_row.id) THEN
      DELETE FROM announcements WHERE id = ann_row.id;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER cleanup_announcements_after_user_performer_follows_delete
AFTER DELETE ON user_performer_follows
FOR EACH ROW
EXECUTE FUNCTION cleanup_announcements_after_performer_unfollow();
--> statement-breakpoint

-- Trigger: a region was removed. Check every announcement whose
-- venue was inside the removed region's bbox. Mirrors the app's
-- removeRegion mutation, but catches direct DB paths too.
CREATE OR REPLACE FUNCTION cleanup_announcements_after_region_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ann_row record;
  lat_delta double precision;
  lng_delta double precision;
BEGIN
  -- Candidates: announcements at venues inside the removed region's
  -- bbox, PLUS announcements at venues with no coordinates. The
  -- no-coords rule in announcement_has_preserver flips from
  -- "preserve" to "delete" when the last active region disappears,
  -- so they have to be re-checked on every region delete.
  IF cos(radians(OLD.latitude)) = 0 THEN
    -- Pole region: bbox is degenerate. Still re-check no-coords rows.
    lat_delta := 0;
    lng_delta := 0;
  ELSE
    lat_delta := OLD.radius_miles / 69.0;
    lng_delta := OLD.radius_miles / (69.0 * cos(radians(OLD.latitude)));
  END IF;

  FOR ann_row IN
    SELECT a.id
    FROM announcements a
    JOIN venues v ON v.id = a.venue_id
    WHERE
      (v.latitude IS NULL OR v.longitude IS NULL)
      OR (
        v.latitude  BETWEEN OLD.latitude  - lat_delta AND OLD.latitude  + lat_delta
        AND v.longitude BETWEEN OLD.longitude - lng_delta AND OLD.longitude + lng_delta
      )
  LOOP
    IF NOT announcement_has_preserver(ann_row.id) THEN
      DELETE FROM announcements WHERE id = ann_row.id;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER cleanup_announcements_after_user_regions_delete
AFTER DELETE ON user_regions
FOR EACH ROW
EXECUTE FUNCTION cleanup_announcements_after_region_delete();
--> statement-breakpoint

-- One-time backfill: catch up any announcements already orphaned
-- before this migration ran (e.g. the prod incident where every user
-- was deleted but announcements stayed). The trigger logic above
-- only fires on future deletes.
DO $$
DECLARE
  ann_row record;
BEGIN
  FOR ann_row IN SELECT id FROM announcements
  LOOP
    IF NOT announcement_has_preserver(ann_row.id) THEN
      DELETE FROM announcements WHERE id = ann_row.id;
    END IF;
  END LOOP;
END $$;
