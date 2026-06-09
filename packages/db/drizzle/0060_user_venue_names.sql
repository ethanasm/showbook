-- Per-user venue name overrides ("aliases").
--
-- Renaming a venue used to mutate the shared `venues.name`, so one user's
-- edit was visible to everyone. Instead, a rename now writes a row here,
-- keyed by (user_id, venue_id), and read paths COALESCE the override over
-- the canonical `venues.name` for the requesting user only (see
-- packages/api/src/venue-names.ts). The canonical name stays the shared
-- baseline set by ingestion / admin.
--
-- Both FKs cascade: deleting a user drops their aliases, and the
-- `cleanup_orphaned_venue` trigger that hard-deletes an unreferenced venue
-- takes its aliases with it. The composite PK serves every lookup
-- (WHERE user_id = ? AND venue_id IN (...)), so no extra index is needed.
--
-- No backfill: past global renames can't be attributed to a user, so the
-- current venues.name becomes the shared baseline everyone sees.
CREATE TABLE "user_venue_names" (
	"user_id" text NOT NULL,
	"venue_id" uuid NOT NULL,
	"custom_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_venue_names_user_id_venue_id_pk" PRIMARY KEY("user_id","venue_id")
);
--> statement-breakpoint
ALTER TABLE "user_venue_names" ADD CONSTRAINT "user_venue_names_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_venue_names" ADD CONSTRAINT "user_venue_names_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;
