-- Cascade structural FKs that should always follow their parent.
--
-- Today five call sites manually delete show_performers before deleting
-- shows (and one of them, discover.unwatchlist, forgets — bug). Likewise
-- enrichment_queue has no cascade, so deleting a freshly-past concert
-- with a queued setlist retry throws on the FK. Both relationships are
-- pure structural housekeeping with no business logic, so they belong
-- in the schema.

ALTER TABLE "show_performers"
  DROP CONSTRAINT "show_performers_show_id_shows_id_fk";
--> statement-breakpoint
ALTER TABLE "show_performers"
  ADD CONSTRAINT "show_performers_show_id_shows_id_fk"
  FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "enrichment_queue"
  DROP CONSTRAINT "enrichment_queue_show_id_shows_id_fk";
--> statement-breakpoint
ALTER TABLE "enrichment_queue"
  ADD CONSTRAINT "enrichment_queue_show_id_shows_id_fk"
  FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- Symmetric performer-orphan cleanup. Mirrors cleanup_orphaned_venue:
-- a performer row is removed once nothing references it across shows,
-- follows, or announcements. Performers are created lazily via
-- matchOrCreatePerformer, so this is the only path that drops them
-- once they go unused.

CREATE OR REPLACE FUNCTION cleanup_orphaned_performer() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  candidate uuid;
BEGIN
  IF TG_TABLE_NAME = 'show_performers' THEN
    candidate := OLD.performer_id;
  ELSIF TG_TABLE_NAME = 'user_performer_follows' THEN
    candidate := OLD.performer_id;
  ELSIF TG_TABLE_NAME = 'announcements' THEN
    candidate := OLD.headliner_performer_id;
  END IF;

  IF candidate IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM show_performers WHERE performer_id = candidate)
     AND NOT EXISTS (SELECT 1 FROM user_performer_follows WHERE performer_id = candidate)
     AND NOT EXISTS (SELECT 1 FROM announcements WHERE headliner_performer_id = candidate) THEN
    DELETE FROM performers WHERE id = candidate;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER cleanup_orphaned_performer_after_show_performers_delete
AFTER DELETE ON show_performers
FOR EACH ROW
EXECUTE FUNCTION cleanup_orphaned_performer();
--> statement-breakpoint

CREATE TRIGGER cleanup_orphaned_performer_after_show_performers_update
AFTER UPDATE ON show_performers
FOR EACH ROW
WHEN (OLD.performer_id IS DISTINCT FROM NEW.performer_id)
EXECUTE FUNCTION cleanup_orphaned_performer();
--> statement-breakpoint

CREATE TRIGGER cleanup_orphaned_performer_after_user_follows_delete
AFTER DELETE ON user_performer_follows
FOR EACH ROW
EXECUTE FUNCTION cleanup_orphaned_performer();

-- Note: announcements rarely change their headliner_performer_id (we
-- never updated this column historically), so we only fire the trigger
-- on DELETE there. If we ever start updating the column, add a matching
-- AFTER UPDATE trigger guarded by a column-changed WHEN.
--> statement-breakpoint

CREATE TRIGGER cleanup_orphaned_performer_after_announcement_delete
AFTER DELETE ON announcements
FOR EACH ROW
EXECUTE FUNCTION cleanup_orphaned_performer();
