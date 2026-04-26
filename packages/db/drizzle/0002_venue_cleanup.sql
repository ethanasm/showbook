ALTER TABLE "venues" DROP COLUMN IF EXISTS "neighborhood";
--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "production_name" text;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cleanup_orphaned_venue() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  candidate uuid;
BEGIN
  candidate := OLD.venue_id;
  IF candidate IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shows WHERE venue_id = candidate) THEN
    DELETE FROM venues WHERE id = candidate;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cleanup_orphaned_venue_after_update
AFTER UPDATE ON shows
FOR EACH ROW
WHEN (OLD.venue_id IS DISTINCT FROM NEW.venue_id)
EXECUTE FUNCTION cleanup_orphaned_venue();
--> statement-breakpoint
CREATE TRIGGER cleanup_orphaned_venue_after_delete
AFTER DELETE ON shows
FOR EACH ROW
EXECUTE FUNCTION cleanup_orphaned_venue();
