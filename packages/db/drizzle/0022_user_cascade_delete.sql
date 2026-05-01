-- Cascade user-owned data when a user is deleted.
--
-- Today only accounts/sessions/media_assets cascade off users.id (added
-- in 0016 and 0020). A `DELETE FROM users` errors as soon as the user
-- has any show, follow, region, or preferences row. This migration adds
-- ON DELETE CASCADE to the remaining user-owned FKs so a user can be
-- purged in one statement and the existing per-show / per-link cascades
-- and orphan triggers chain through.
--
-- Shared reference data (venues, performers, announcements) is NOT
-- user-owned and is intentionally NOT cascaded off the user. Venues and
-- performers are shrunk by the existing cleanup_orphaned_* triggers
-- once nothing references them. Announcements stay around — they are
-- shared discovery data with no per-user FK; the venue.unfollow router
-- already handles selective announcement pruning when the last follow
-- at a venue goes away, and that path keeps working unchanged.
--
-- Two pre-existing gaps in the orphan triggers are fixed here so the
-- chain doesn't break when the new cascades fire:
--
--   1. cleanup_orphaned_venue did not check user_venue_follows. Once
--      the venue's last show + announcement are gone, the trigger
--      would try DELETE FROM venues, but user_venue_follows.venue_id
--      has no ON DELETE CASCADE, so any leftover follow row would
--      raise a FK violation. Add the follows check, and add a trigger
--      so deleting the last follow also tries the cleanup.
--
--   2. cleanup_orphaned_performer did not check media_asset_performers
--      (introduced in 0016, after the trigger was authored in 0014).
--      A performer with no shows/follows/announcements but still tagged
--      in a photo would be silently deleted because
--      media_asset_performers.performer_id cascades. Add the check, and
--      add a trigger so deleting the last asset tag tries the cleanup.
--
-- Each ALTER first deletes any pre-existing orphan rows; without that
-- the new constraint would fail to attach if old rows pointed at a
-- missing user. There should be none in practice, but the guard is
-- cheap and matches the pattern used in 0020.

DELETE FROM "shows" WHERE "user_id" NOT IN (SELECT "id" FROM "users");
--> statement-breakpoint
ALTER TABLE "shows" DROP CONSTRAINT "shows_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "shows"
  ADD CONSTRAINT "shows_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

DELETE FROM "user_venue_follows" WHERE "user_id" NOT IN (SELECT "id" FROM "users");
--> statement-breakpoint
ALTER TABLE "user_venue_follows" DROP CONSTRAINT "user_venue_follows_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_venue_follows"
  ADD CONSTRAINT "user_venue_follows_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

DELETE FROM "user_performer_follows" WHERE "user_id" NOT IN (SELECT "id" FROM "users");
--> statement-breakpoint
ALTER TABLE "user_performer_follows" DROP CONSTRAINT "user_performer_follows_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_performer_follows"
  ADD CONSTRAINT "user_performer_follows_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

DELETE FROM "user_regions" WHERE "user_id" NOT IN (SELECT "id" FROM "users");
--> statement-breakpoint
ALTER TABLE "user_regions" DROP CONSTRAINT "user_regions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_regions"
  ADD CONSTRAINT "user_regions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

DELETE FROM "user_preferences" WHERE "user_id" NOT IN (SELECT "id" FROM "users");
--> statement-breakpoint
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
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
  IF NOT EXISTS (SELECT 1 FROM shows WHERE venue_id = candidate)
     AND NOT EXISTS (SELECT 1 FROM announcements WHERE venue_id = candidate)
     AND NOT EXISTS (SELECT 1 FROM user_venue_follows WHERE venue_id = candidate) THEN
    DELETE FROM venues WHERE id = candidate;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER cleanup_orphaned_venue_after_user_follows_delete
AFTER DELETE ON user_venue_follows
FOR EACH ROW
EXECUTE FUNCTION cleanup_orphaned_venue();
--> statement-breakpoint

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
  ELSIF TG_TABLE_NAME = 'media_asset_performers' THEN
    candidate := OLD.performer_id;
  END IF;

  IF candidate IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM show_performers WHERE performer_id = candidate)
     AND NOT EXISTS (SELECT 1 FROM user_performer_follows WHERE performer_id = candidate)
     AND NOT EXISTS (SELECT 1 FROM announcements WHERE headliner_performer_id = candidate)
     AND NOT EXISTS (SELECT 1 FROM media_asset_performers WHERE performer_id = candidate) THEN
    DELETE FROM performers WHERE id = candidate;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER cleanup_orphaned_performer_after_media_asset_performers_delete
AFTER DELETE ON media_asset_performers
FOR EACH ROW
EXECUTE FUNCTION cleanup_orphaned_performer();
