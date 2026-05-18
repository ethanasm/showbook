-- Phase 5 of setlist-intelligence — style classifier persistence.
-- See docs/specs/setlist-intelligence/phases/phase-05-style-classifier-rotating.md.
--
-- The Phase-0 schema added `setlist_style` + `setlist_style_inferred_at`
-- to `performers`. Phase 5 extends with:
--   setlist_style_override   — operator/user manual override. Always wins
--                              over the auto-classifier.
--   computed_style           — last auto-classified style from the
--                              nightly setlist-style-refresh cron.
--   style_disagreement_count — three-runs-to-disagree counter. Increments
--                              each cron run where the auto-classifier
--                              disagrees with the seed table entry. At
--                              ≥3 the cron flips `setlist_style` to the
--                              auto-classified value.

ALTER TABLE "performers"
  ADD COLUMN "setlist_style_override" text;
--> statement-breakpoint
ALTER TABLE "performers"
  ADD COLUMN "computed_style" text;
--> statement-breakpoint
ALTER TABLE "performers"
  ADD COLUMN "style_disagreement_count" integer NOT NULL DEFAULT 0;
