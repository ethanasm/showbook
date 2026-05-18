# Phase 11 — §15 polish (album-drop · special events · etc.)

> **Goal.** Compound the value with the smaller §15 wins that
> matter once the core feature is stable. Album-drop forward
> signal, special-event detection, set-count prediction propagation,
> community correction loop, spoiler-blur propagation across other
> surfaces.

| Estimated effort | ~2 weeks |
| Critical path? | No |
| Prerequisites | Phases 1, 5 (style classifier), 7 (album metadata from track-resolve extension) |
| Ships | The §15 deferred items in priority order |

References:
- [`../feature-plan.md`](../feature-plan.md) §15 (the self-audit)
- [`../feature-plan.md`](../feature-plan.md) §15t (the shortlist)

---

## What's in scope

The §15t shortlist's items #4–#10 (items #1–#3 ship in Phases 5/4):

| # | §15 reference | Item |
|---|---------------|------|
| 4 | §15m | Album-drop forward signal |
| 5 | §15j | Personal weighting overlay (already partially shipped in Phase 7; finish here) |
| 6 | §15e | Multi-night anti-repeat for non-Phish artists |
| 7 | §15f | Set count / show length prediction propagation |
| 8 | §15g | Special-event detection |
| 9 | §15l | Real-time corpus refresh during multi-night runs |
| 10 | §15o | Spoiler-blur propagation across surfaces |

Plus a small handful of §15r table items.

---

## Code

### §15m Album-drop forward signal

When an artist releases an album within ±60 days of the target
show, seed expected-from-new-album rows with weight 0.3 and
`evidence: "expected from new album [name]"`. Decays as real
evidence comes in.

Schema:
- Already have `songs.spotify_album_release` from Phase 3's
  track-resolve extension
- New `albums` table for canonical release data:
  ```sql
  CREATE TABLE albums (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    performer_id      uuid NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
    spotify_album_id  text NOT NULL,
    name              text NOT NULL,
    release_date      date NOT NULL,
    album_type        text,
    track_ids         text[]    -- spotify track IDs
  );
  CREATE UNIQUE INDEX albums_spotify_unique
    ON albums (spotify_album_id);
  ```

Job: `packages/jobs/src/album-metadata-fill.ts` — for each
performer, fetch the latest 5 albums; cache.

Algorithm: in `setlist-predict.ts`, when the target date is within
±60 days of an album release whose tracks aren't yet in the
corpus, synthesize Tier-A appearances at weight 0.3 with the
"expected" evidence string.

### §15g Special-event detection

```sql
CREATE TABLE special_event_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performer_id uuid NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  rule_kind    text NOT NULL,        -- 'date_match' | 'venue_run' | 'tour_name_pattern'
  pattern      jsonb NOT NULL,
  effect       jsonb NOT NULL,
  source       text NOT NULL         -- 'manual' | 'auto'
);
```

Auto-detected rules for the obvious classes (Halloween → Phish,
Springsteen NYE marathons, Sphere residencies). Manual rules
covered via an admin UI on `/admin/eval` (extend Phase 4's page).

When a target date matches a rule, the prediction returns the
`special_event` empty state with copy + past events.

### §15f Set-count prediction propagation

The Phase 5 `RotatingPredictedSetlist` already has
`setCountPrediction`. Phase 11 promotes it to a top-level field on
*all* prediction styles (stable, theatrical, improvised) — the
prediction always tells the user how many sets and how long. This
involves moving it from the rotating-only branch to the union's
shared shape.

Mostly a refactor + UI plumbing — small but worth doing once
predictions are stable.

### §15e Multi-night anti-repeat (non-Phish use cases)

Phase 5 shipped the detector, scoped to rotating-style. Generalize
to also fire for stable-style artists doing a residency (Adele,
Bruno Mars at the Sphere). Same code; different triggers.

### §15l Real-time corpus refresh during multi-night runs

When a `watching` show falls during a detected multi-night run AND
the artist's most recent corpus setlist is older than 12 hours, run
`setlist-corpus-fill predict` every 3 hours instead of waiting for
the next nightly. Cap to one performer per user per day.

Triggers via a small `setlist-tour-watch.ts` job that wakes every
3 hours during a run.

### §15j Personal weighting overlay (finish)

Phase 7 shipped the data backing for `💛 saved` and `🎯 first-time`
chips. Phase 11 finishes:

- `⭐ top track` chip data from Phase 7's
  `user_spotify_top_tracks` sync
- A "songs you'd want to hear" rail on the predicted-setlist tab —
  filtered subset of `core ∪ likely` that have at least one chip

### §15o Spoiler-blur propagation

Today `spoilerBlurDefault` is honored only on the predicted-
setlist tab. Phase 11 propagates:

- **Daily digest email** (`packages/jobs/src/notifications.ts`) —
  the "tonight's predicted setlist" tile respects
  `userPreferences.setlist_spoilers`
- **Brain replies** (when Brain ships) — the `predicted_setlist`
  card pre-renders empty when blur is on
- **Push notifications** — the title + body avoid song-title
  spoilers
- New `userPreferences.setlist_spoilers` enum:
  `'always_blur' | 'never_blur' | 'style_default'`. Default
  `style_default`. Also surfaced as a toggle below the spoiler
  curtain CTA per [`../implementation.md`](../implementation.md)
  §11 Q5.

### §15n Community correction loop

A "report a missing/wrong song" CTA on the prediction view writes
to a `setlist_corrections` table. After N concurring proposals,
local corpus row marked `disputed` and a setlist.fm refetch
queued.

```sql
CREATE TABLE setlist_corrections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tour_setlist_id   uuid NOT NULL REFERENCES tour_setlists(id) ON DELETE CASCADE,
  proposed_change   jsonb NOT NULL,
  resolved          boolean NOT NULL DEFAULT false,
  resolved_at       timestamp,
  created_at        timestamp NOT NULL DEFAULT now()
);
```

Defer to v1.1 unless real misfires surface in dogfooding.

### §15r table items

Smaller wins from the §15r table that fit naturally here:

- **Festival vs headline corpus filter** — Phase 5 implements multi-
  night runs; this adds a similar split for festival vs headline
  appearances so a festival show predicts from the artist's
  shorter-set corpus
- **Tour-id year salt** — when synthesizing `tour_id` from
  `(performerId, lower(tour.name))`, salt with the year of the
  earliest setlist in the run to avoid cross-year collisions
- **`predictSetlist` cache TTL** — add 4-hour TTL even when the
  corpus is stale (per
  [`../implementation.md`](../implementation.md) §11 Q6)
- (SI-18 cut) **Per-row "was this useful?" thumbs** — dropped.
  We were planning to collect feedback without a concrete plan to
  use it, which is data debt. If a future phase wants the signal,
  ship the UI, the table, and the closing-the-loop wiring
  together at that point.

### §SI-10 revoked-token hard-delete cron

Small weekly pg-boss cron (`spotify/purge-revoked-tokens`):

```ts
DELETE FROM user_spotify_tokens
WHERE revoked_at IS NOT NULL
  AND revoked_at < now() - interval '30 days';
```

About 5 lines of registry code. Closes the 30-day audit window
the spec promised for revoked rows. Runs weekly on Sundays so
audit queries during a triage window have full coverage.

---

## Tests

### Unit

- Album-drop weight injection produces expected probability lift
- Special-event rule matching for the Phish Halloween case
- Set-count prediction propagation across prediction-style branches
- Spoiler-blur propagation across digest + push templates
- Personal-weight chip rendering with all three chip types

### Integration

- For Phish Halloween show, prediction returns
  `style: 'special_event'` with documented copy
- For Sabrina-Carpenter-style mid-tour album drop, predicted
  setlist lifts new-album song probabilities
- Tour-id year salt: re-using a tour name across years produces
  distinct `tour_id`s

---

## Observability events

- `setlist.album_drop.boosted`
- `setlist.special_event.matched`
- `setlist.tour_watch.refreshed`
- `spotify.purge_revoked.summary` (count of rows deleted per run)

---

## Exit criteria

1. Adding a manual special-event rule for Phish Halloween
   produces the documented "we won't predict this one" empty state.
2. Album-drop forward signal lifts new-album track probability on
   shows in the ±60-day release window — verified against a
   replay of the Sabrina Carpenter October 2025 case.
3. Spoiler-blur honored across digest emails AND predicted-
   setlist tab AND any Brain reply by Phase 11 close.
4. Tour-id year salt prevents cross-year collisions in a
   verification fixture.
5. Multi-night-run detection generalizes to non-rotating
   residencies in a fixture (Adele Caesars Palace, Bruno Mars
   Sphere).

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Album-drop signal over-predicts on tracks the artist isn't actually playing | Decay weight as real evidence comes in; cap synthetic-appearance weight at 0.3 |
| Special-event rules become a curation maintenance burden | Auto-detect the obvious cases (Halloween, NYE); manual rules are an admin escape hatch, not the main path |
| Personal-weight chips clutter the row at high density | Cap at one chip per row when density='compact' |
| Real-time corpus refresh blows the rate limit | One-performer-per-user-per-day cap; only fires during detected runs |

---

## What this phase does NOT include

- Conditional / pair patterns (`P(B | A played earlier)`) — deferred
  per [`../feature-plan.md`](../feature-plan.md) §15s
- Per-venue song boost ("this song lives at MSG") — defer until
  per-venue corpus is large enough
- Band-specific data sources (Phish.net gap-chart API) — defer
  unless the generic gap algorithm proves insufficient
- LLM-generated improvised-style descriptors (Phase 6 sticks with
  hand-curated)
