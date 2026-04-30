-- Add FK + ON DELETE CASCADE to accounts.user_id and sessions.user_id.
-- These tables are written by Auth.js (next-auth) and originally landed in
-- 0001 without any FK reference, so deleting a user left orphaned account /
-- session rows. Cascade also lets the user-delete path stay one query.
--
-- Clean up any existing orphans first; the constraint creation will fail if
-- non-null user_ids point to a row that no longer exists.

DELETE FROM "accounts"
WHERE "user_id" NOT IN (SELECT "id" FROM "users");
--> statement-breakpoint
DELETE FROM "sessions"
WHERE "user_id" NOT IN (SELECT "id" FROM "users");
--> statement-breakpoint
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
