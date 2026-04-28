-- Discover overhaul: theatre run grouping, scraped source, scrape runs, nullable show date

-- 1. Add 'scraped' to announcement_source enum
ALTER TYPE "announcement_source" ADD VALUE IF NOT EXISTS 'scraped';
--> statement-breakpoint

-- 2. Add run-grouping columns to announcements
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "production_name" text;
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "run_start_date" date;
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "run_end_date" date;
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "performance_dates" date[];
--> statement-breakpoint

-- 3. Backfill: existing rows get run_start_date = run_end_date = show_date
UPDATE "announcements"
SET "run_start_date" = "show_date", "run_end_date" = "show_date"
WHERE "run_start_date" IS NULL;
--> statement-breakpoint

-- 4. Make shows.date nullable (state='watching' AND date IS NULL = "intent without date")
ALTER TABLE "shows" ALTER COLUMN "date" DROP NOT NULL;
--> statement-breakpoint

-- 5. Create scrape_run_status enum
DO $$ BEGIN
  CREATE TYPE "scrape_run_status" AS ENUM ('running', 'success', 'error');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 6. Create venue_scrape_runs table
CREATE TABLE IF NOT EXISTS "venue_scrape_runs" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "venue_id" uuid NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "status" "scrape_run_status" NOT NULL,
  "events_found" integer DEFAULT 0 NOT NULL,
  "events_created" integer DEFAULT 0 NOT NULL,
  "groq_tokens_used" integer,
  "error_message" text,
  "page_html_excerpt" text
);
--> statement-breakpoint

-- 7. FK and index for venue_scrape_runs
DO $$ BEGIN
  ALTER TABLE "venue_scrape_runs"
    ADD CONSTRAINT "venue_scrape_runs_venue_id_venues_id_fk"
    FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "venue_scrape_runs_venue_idx" ON "venue_scrape_runs" ("venue_id");
