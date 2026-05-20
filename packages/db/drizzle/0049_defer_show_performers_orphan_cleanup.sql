-- Defer the performer-orphan-cleanup triggers on show_performers so they
-- fire at COMMIT instead of at the end of each DELETE / UPDATE statement.
--
-- Why: `shows.update` writes the lineup by DELETE-then-INSERT inside a
-- single transaction. The previous AFTER ROW triggers fired between the
-- two statements; if a deleted performer had no remaining references in
-- show_performers / user_performer_follows / announcements /
-- media_asset_performers (very common for festival support artists that
-- nobody follows), the trigger would remove the performer row, and the
-- subsequent INSERT in the same transaction would then fail with a
-- foreign-key violation on show_performers.performer_id. The mobile edit
-- screen surfaced that as the "Failed query: insert into show_performers
-- ..." toast.
--
-- Constraint triggers run at COMMIT (or `SET CONSTRAINTS IMMEDIATE`) when
-- declared DEFERRABLE INITIALLY DEFERRED, so by the time the orphan check
-- runs the INSERT has already replaced the references and the trigger
-- correctly sees the performer as still in use. Cascade-delete-of-show
-- and stand-alone DELETE FROM show_performers without a matching INSERT
-- still work the same: the deferred trigger fires at COMMIT and the
-- cleanup happens.
--
-- Only the show_performers triggers are migrated. The other three
-- triggers on this function (user_performer_follows, announcements,
-- media_asset_performers) don't appear in any DELETE+INSERT-same-row
-- pattern, so leaving them as regular AFTER triggers keeps the cleanup
-- immediate where it's safe.

DROP TRIGGER IF EXISTS cleanup_orphaned_performer_after_show_performers_delete ON show_performers;
--> statement-breakpoint
DROP TRIGGER IF EXISTS cleanup_orphaned_performer_after_show_performers_update ON show_performers;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER cleanup_orphaned_performer_after_show_performers_delete
AFTER DELETE ON show_performers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION cleanup_orphaned_performer();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER cleanup_orphaned_performer_after_show_performers_update
AFTER UPDATE ON show_performers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD.performer_id IS DISTINCT FROM NEW.performer_id)
EXECUTE FUNCTION cleanup_orphaned_performer();
