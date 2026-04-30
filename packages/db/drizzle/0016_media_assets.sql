CREATE TYPE "public"."media_type" AS ENUM('photo', 'video');
--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('pending', 'ready', 'failed');
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"show_id" uuid NOT NULL,
	"media_type" "media_type" NOT NULL,
	"status" "media_status" DEFAULT 'pending' NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"variants" jsonb,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_asset_performers" (
	"asset_id" uuid NOT NULL,
	"performer_id" uuid NOT NULL,
	CONSTRAINT "media_asset_performers_asset_id_performer_id_pk" PRIMARY KEY("asset_id","performer_id")
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_asset_performers" ADD CONSTRAINT "media_asset_performers_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_asset_performers" ADD CONSTRAINT "media_asset_performers_performer_id_performers_id_fk" FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "media_assets_user_idx" ON "media_assets" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "media_assets_show_idx" ON "media_assets" USING btree ("show_id","status","sort_order");
--> statement-breakpoint
CREATE INDEX "media_assets_type_idx" ON "media_assets" USING btree ("media_type");
--> statement-breakpoint
CREATE INDEX "media_asset_performers_performer_idx" ON "media_asset_performers" USING btree ("performer_id");
