-- Extend the orphaned-venue cleanup so a venue is removed once it has no
-- shows AND no announcements referencing it. Previously the trigger only
-- fired on shows mutations and only checked the shows table, so deleting
-- the last announcement for an unfollowed venue would leave the venue row
-- behind.

CREATE OR REPLACE FUNCTION cleanup_orphaned_venue() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  candidate uuid;
BEGIN
  candidate := OLD.venue_id;
  IF candidate IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shows WHERE venue_id = candidate)
     AND NOT EXISTS (SELECT 1 FROM announcements WHERE venue_id = candidate) THEN
    DELETE FROM venues WHERE id = candidate;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cleanup_orphaned_venue_after_announcement_delete
AFTER DELETE ON announcements
FOR EACH ROW
EXECUTE FUNCTION cleanup_orphaned_venue();
--> statement-breakpoint
CREATE TRIGGER cleanup_orphaned_venue_after_announcement_update
AFTER UPDATE ON announcements
FOR EACH ROW
WHEN (OLD.venue_id IS DISTINCT FROM NEW.venue_id)
EXECUTE FUNCTION cleanup_orphaned_venue();
