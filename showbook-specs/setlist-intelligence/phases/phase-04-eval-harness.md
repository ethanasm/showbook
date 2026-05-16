# Phase 4 — Eval harness + calibration

> **Goal.** Make the confidence numbers trustworthy. Weekly Brier
> score + per-bin calibration curve. Run in shadow mode through this
> phase; gate enforces from Phase 5 onward.

| Estimated effort | ~1 week |
| Critical path? | No (parallel to Phases 2, 3) |
| Prerequisites | Phase 1 |
| Ships | Admin-only `/admin/eval` page; weekly cron writing `prediction_eval_runs` |

References:
- [`../feature-plan.md`](../feature-plan.md) §15i (the calibration
  story), §15q (release gate)

---

## Why this is its own phase

We ship Phase 1 with a confidence number on every prediction. That
number is *internally* derived from a Bayesian model — but until
we've measured whether 92%-confident predictions actually come true
92% of the time, the number is decorative.

This phase fixes that with a back-test harness that walks the
corpus, predicts as it would have looked the day before each
historical setlist, and compares against the actual played songs.

---

## Code

### `scripts/eval-setlist-predictor.ts` (new)

For each (performer, date) pair from `tour_setlists` over the past
30 days:

1. Truncate `tour_setlists` to `performance_date < target_date` (in
   memory; we don't actually delete from the DB).
2. Run `predictSetlist({ performerId, targetDate })` against the
   truncated corpus.
3. Compare predicted `core ∪ likely` (probabilities ≥ 0.35) against
   the actual played songs.
4. Bin predictions by stated probability (5 bins: 0–20%, 20–40%,
   40–60%, 60–80%, 80–100%) and report the actual hit rate per
   bin.
5. Output a JSON report.

Run via `pnpm tsx scripts/eval-setlist-predictor.ts` for ad-hoc, or
via the cron below.

### `packages/jobs/src/prediction-eval.ts` (new)

Daily cron at 02:00 ET. Calls the same eval logic, writes a row
to `prediction_eval_runs`:

The base table was created in Phase 0 (`0034_setlist_intel_foundation.sql`)
with `precision_top10 real NOT NULL` and `recall_top10 real NOT NULL`.
Phase 4 adds the rotating-style gate metric:

```sql
-- Phase 4 migration
ALTER TABLE prediction_eval_runs
  ADD COLUMN recall_top15 real;
-- Backfill is unnecessary — the cron starts populating new rows.
```

The full table after Phase 4:

```sql
CREATE TABLE prediction_eval_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at            timestamp NOT NULL DEFAULT now(),
  predictions       integer NOT NULL,
  brier_score       real NOT NULL,
  calibration_curve jsonb NOT NULL,
  -- Stable-style success metric (precision-at-10).
  precision_top10   real NOT NULL,
  -- Legacy from the Phase 0 schema; eval still writes this for
  -- historical comparison but the rotating-style release gate
  -- moved to recall_top15 (SI-14).
  recall_top10      real NOT NULL,
  -- Rotating-style success metric (SI-14). The rotating UX shows a
  -- ~30-candidate gap chart; users judge it by "did the songs that
  -- played appear in the chart somewhere?" — recall, not precision.
  -- K=15 matches a typical Phish set length.
  recall_top15      real,
  by_style          jsonb NOT NULL
);
```

(Migration ships in Phase 0.)

### `apps/web/app/(app)/admin/eval/page.tsx` (new)

Admin-only page (gated by `ADMIN_EMAILS` allowlist — pattern
already in production). Renders:

- Brier score line chart over time
- Latest calibration curve as a bin-by-bin chart
- Per-style breakdown (stable / rotating / theatrical / improvised
  metrics on the same axes)
- A small table of recent runs

Uses the same `MiniChart` shape the brain plan introduces.

---

## The release gate (turns on in Phase 5)

Phase 5 ships with the gate enforced:

- Stable-style mean Brier ≤ 0.15
- Rotating-style mean **recall-at-15 ≥ 0.55** (SI-14: switched
  from precision-at-10 because the rotating UX is a ~30-candidate
  gap chart; the question users will judge is "did the played
  songs appear in the chart?" — that's recall, not precision).
  K=15 matches a typical Phish set length.
- No artist with ≥5 Tier-A setlists has calibration error >20pp in
  any bin

If those thresholds aren't met when Phase 5 is ready to ship, we
adjust — either tune `TIER_WEIGHTS` and the smoothing prior, or
push the release back until calibration is in range.

In Phase 4 itself, the cron runs in shadow mode: results land in
the DB and the admin page, but no automated gate. We hand-watch
for 14+ days to confirm the eval is itself trustworthy before
turning on the gate.

---

## Tests

### Unit

- `packages/api/src/__tests__/eval-binning.test.ts` — binning math
  on synthetic prediction-vs-actual pairs
- `packages/api/src/__tests__/eval-corpus-truncate.test.ts` —
  truncation logic produces the same output as fetching the corpus
  fresh at the truncation date

### Integration

- Run the full eval against a seeded fixture of 30 days of
  tour_setlists; assert the resulting `prediction_eval_runs` row
  has plausible numbers

---

## Observability events

- `setlist.eval.run_complete` (payload: brier, precision_top10,
  recall_top15, per-style breakdown)
- `setlist.eval.run_failed`

---

## Exit criteria

1. The eval cron runs cleanly for 14 consecutive days.
2. Stable-style Brier comes in ≤ 0.15 across all stable-style
   performers in the corpus.
3. Rotating-style recall-at-15 comes in ≥ 0.55 (per SI-14 — the
   metric the gap-chart UX is judged by; supersedes the original
   precision-at-10 ≥ 0.4 gate).
4. Calibration curve is within 20pp of perfect for every
   probability bin in the stable-style cohort.
5. The admin page renders the curve cleanly on prod data.

If exit criteria 2–4 don't pass: we tune `TIER_WEIGHTS` and the
Beta(α, β) prior in `setlist-predict.ts` until they do. Phase 5
remains gated until then.

---

## What this phase does NOT include

- Any user-facing feature
- The release gate enforcement (Phase 5+)
- Per-user calibration ("your predictions are 80% accurate")
- A/B testing different prediction models
- Integration with the brain (the eval is for the prediction model
  itself, not Brain answers)
