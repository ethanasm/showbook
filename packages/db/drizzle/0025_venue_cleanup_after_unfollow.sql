-- Close the user_venue_follows gap in cleanup_orphaned_venue.
--
-- Migration 0002 only fires the venue-orphan check on shows DELETE/UPDATE.
-- 0023 cleans announcements when a venue follow is removed, but the venue
-- row itself is never re-evaluated. So a venue that was followed-only
-- (no shows, all announcements pruned) outlives the user that followed it
-- — exactly what the prod incident showed when the last user was deleted.
--
-- This trigger fires AFTER DELETE on user_venue_follows. The `zz_` prefix
-- forces it to run after 0023's `cleanup_announcements_after_user_venue_
-- follows_delete` (Postgres fires per-row triggers in alphabetical order),
-- so the announcement re-check has already pruned anything it can before
-- we look for shows / follows / announcements still pointing at the venue.
--
-- The DO block at the bottom is a one-time backfill for venues left
-- orphaned by past prod cleanups (matches the 0023 backfill style).

CREATE OR REPLACE FUNCTION cleanup_orphaned_venue_after_unfollow() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  candidate uuid;
BEGIN
  candidate := OLD.venue_id;
  IF candidate IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM shows WHERE venue_id = candidate)
     AND NOT EXISTS (SELECT 1 FROM user_venue_follows WHERE venue_id = candidate)
     AND NOT EXISTS (SELECT 1 FROM announcements WHERE venue_id = candidate) THEN
    DELETE FROM venues WHERE id = candidate;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER zz_cleanup_orphaned_venue_after_unfollow
AFTER DELETE ON user_venue_follows
FOR EACH ROW
EXECUTE FUNCTION cleanup_orphaned_venue_after_unfollow();
--> statement-breakpoint

-- One-time backfill: venues with no shows, no follows, and no
-- announcements are dead. Runs after 0023 has cleared the matching
-- orphan announcements.
DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT v.id
    FROM venues v
    WHERE NOT EXISTS (SELECT 1 FROM shows WHERE venue_id = v.id)
      AND NOT EXISTS (SELECT 1 FROM user_venue_follows WHERE venue_id = v.id)
      AND NOT EXISTS (SELECT 1 FROM announcements WHERE venue_id = v.id)
  LOOP
    DELETE FROM venues WHERE id = v_row.id;
  END LOOP;
END $$;
