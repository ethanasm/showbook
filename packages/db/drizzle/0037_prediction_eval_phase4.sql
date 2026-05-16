-- Phase 4 of setlist-intelligence — eval harness persistence.
-- See showbook-specs/setlist-intelligence/phases/phase-04-eval-harness.md.
--
-- Extends `prediction_eval_runs` with the rotating-style gate metric
-- `recall_top15` (SI-14). The Phase-0 schema shipped `recall_top10`;
-- the harness keeps writing both for historical comparison.
--
-- Adds two new tables:
--   prediction_eval_shows  — per-show backtest breakdown so the admin
--                            page can show the most-recent N rows and
--                            the "Re-run for show" button has a row to
--                            target.
--   prediction_snapshots   — immutable record of every prediction
--                            served to a user, so a future eval pass
--                            can score the prediction that was
--                            actually shown rather than re-deriving
--                            from the current corpus.

ALTER TABLE "prediction_eval_runs"
  ADD COLUMN "recall_top15" real;
--> statement-breakpoint
ALTER TABLE "prediction_eval_runs"
  ADD COLUMN "window_days" integer NOT NULL DEFAULT 14;
--> statement-breakpoint

CREATE TABLE "prediction_eval_shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"tour_setlist_id" uuid,
	"performer_id" uuid NOT NULL,
	"performer_name" text NOT NULL,
	"performance_date" date NOT NULL,
	"style" text NOT NULL,
	"brier" real NOT NULL,
	"precision_top10" real NOT NULL,
	"recall_actual" real NOT NULL,
	"recall_top15" real,
	"sample_size" integer NOT NULL,
	"predicted" jsonb NOT NULL,
	"actual" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prediction_eval_shows"
  ADD CONSTRAINT "prediction_eval_shows_run_id_prediction_eval_runs_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."prediction_eval_runs"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prediction_eval_shows"
  ADD CONSTRAINT "prediction_eval_shows_tour_setlist_id_tour_setlists_id_fk"
  FOREIGN KEY ("tour_setlist_id") REFERENCES "public"."tour_setlists"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prediction_eval_shows"
  ADD CONSTRAINT "prediction_eval_shows_performer_id_performers_id_fk"
  FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "prediction_eval_shows_run_idx"
  ON "prediction_eval_shows" USING btree ("run_id", "performance_date" DESC);
--> statement-breakpoint
CREATE INDEX "prediction_eval_shows_performer_date_idx"
  ON "prediction_eval_shows" USING btree ("performer_id", "performance_date" DESC);
--> statement-breakpoint

CREATE TABLE "prediction_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"performer_id" uuid NOT NULL,
	"target_date" date NOT NULL,
	"served_to_user_id" text,
	"show_id" uuid,
	"corpus_signature" text NOT NULL,
	"prediction_json" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prediction_snapshots"
  ADD CONSTRAINT "prediction_snapshots_performer_id_performers_id_fk"
  FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prediction_snapshots"
  ADD CONSTRAINT "prediction_snapshots_served_to_user_id_users_id_fk"
  FOREIGN KEY ("served_to_user_id") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prediction_snapshots"
  ADD CONSTRAINT "prediction_snapshots_show_id_shows_id_fk"
  FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "prediction_snapshots_performer_date_idx"
  ON "prediction_snapshots" USING btree ("performer_id", "target_date" DESC);
--> statement-breakpoint
CREATE INDEX "prediction_snapshots_show_idx"
  ON "prediction_snapshots" USING btree ("show_id")
  WHERE "show_id" IS NOT NULL;
