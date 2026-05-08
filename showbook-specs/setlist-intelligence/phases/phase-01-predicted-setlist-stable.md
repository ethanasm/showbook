# Phase 1 — Predicted setlist (stable-style MVP)

> **Goal.** Tate McRae case end-to-end on web. Tour-aware Bayesian
> probability model + corpus fill + the one display variant the
> majority of users will see. No mobile, no Spotify export, no
> rotating-style yet.

| Estimated effort | ~2 weeks |
| Critical path? | Yes |
| Prerequisites | Phase 0 |
| Ships | Web `/(app)/shows/[id]/predicted/` for stable-style artists |

References:
- [`../feature-plan.md`](../feature-plan.md) §3 (jobs), §4c (algorithm)
- [`../worked-examples.md`](../worked-examples.md) §1 (Tate McRae)
- [`../ui-spec.md`](../ui-spec.md) §3 (Tate McRae screen)

---

## Code

### `packages/api/src/setlist-predict.ts` (new)

The tour-aware probability model. Inputs `{ performerId, targetDate
}`; output is the `PredictedSetlist` discriminated union from
[`../feature-plan.md`](../feature-plan.md) §4c.

Five-tier corpus weighting:

| Tier | Definition | Weight |
|------|-----------|--------|
| A — current leg | Same `tour_id`, ±30d of target | 1.00 |
| B — current tour | Same `tour_id`, ±180d | 0.55 |
| C — earlier same tour | Same `tour_id`, older | 0.20 |
| D — most recent prior tour | Previous distinct `tour_id`, last 365d | 0.10 |
| E — anything else recent | Last 365d, no other match | 0.04 |

Bayesian smoothing with `Beta(α=2, β=2)` prior. Active-tour anchor
floors `p` at 0.85 when a song is in ≥80% of Tier A and the leg
started within 60 days. One-off suppressor diverts songs with
`N_song == 1` into the `rotation` bucket.

Pure helpers — `loadCorpus`, `bucketTiers`, `aggregate`, `pickRole`,
`bucketByProbability`, `computeConfidence` — each unit-tested.

Caches via `prediction_cache` table keyed by `(performerId,
targetDate, max(tour_setlists.fetched_at))`. Cache invalidates when
the corpus-fill job touches a setlist for the performer.

### `packages/jobs/src/setlist-corpus-fill.ts` (new)

Three modes (the `mode` job arg):

| Mode | Pages | When triggered |
|------|-------|----------------|
| `predict` | 3 | User follows artist; `shows-nightly` for any artist with a watching show in the next 30 days; show-detail page open + corpus older than 24h |
| `deep` | 10 | Songs page open + corpus older than 7 days OR <20 setlists |
| `refresh` | 1 | Daily 04:45 ET cron, top-500 followed performers |

Tour ID synthesis: `(performerId, lower(tourName))` (open question
[`../implementation.md`](../implementation.md) §11 Q3 for the salt-
with-year mitigation if needed). Tour-leg extraction via regex on
the tour name.

Rate-budget math: 500 artists/day × 1 page = 500 calls.
`setlist-retry` is the larger consumer. Stays under setlist.fm's
1440/day default; request the upgrade preemptively per
[`../implementation.md`](../implementation.md) §11 Q8.

### `packages/jobs/src/song-index-rebuild.ts` (new)

Walks `shows.setlists` + `tour_setlists`; upserts `songs` rows;
inserts `setlist_song_appearances` rows; refreshes
`user_song_stats` matview. Idempotent — re-running against the full
DB produces zero duplicates.

Schedule: chained after `shows-nightly` and after each
`setlist-corpus-fill` completion.

### `scripts/backfill-song-index.ts` (new)

One-time backfill of existing `shows.setlists` jsonb → `songs` +
`setlist_song_appearances`. Reuses the indexer logic; no new
behavior. Run once via `pnpm --filter @showbook/jobs tsx
scripts/backfill-song-index.ts`.

### `packages/api/src/routers/setlist-intel.ts` (new)

Phase 1 procedures:

```ts
setlistIntel.predictedSetlist({ showId })
setlistIntel.songsHeardMost({ scope: 'all'|'performerId', limit })
setlistIntel.tourDebutsCaught({ performerId? })
setlistIntel.setlistDiff({ showIdA, showIdB })
setlistIntel.firstTimes()
```

`predictedSetlist` returns the `PredictedSetlist` union; only the
stable-style branch is populated in this phase. Other styles return
the `cold` empty state with `tourCoverage: 'cold'` until Phase 5/6.

### Web UI

New route: `apps/web/app/(app)/shows/[id]/predicted/page.tsx`
(rendered inside the existing show-detail page via the new
`SegmentedControl` switcher).

`apps/web/app/(app)/shows/[id]/page.tsx` (edit) — add a
`SegmentedControl` between `Setlist · Predicted · Songs`.
**Predicted** is the default segment when `state ∈ {watching,
ticketed}` and a prediction exists.

New components in
`apps/web/components/predicted-setlist/`:

| Component | Purpose |
|-----------|---------|
| `PredictionHero` | Confidence dial + tour metadata + set-shape strip |
| `SpoilerCurtain` | Covers titles until tap |
| `PredictionSongRow` | Row workhorse — title + prob bar + role + chips |
| `ProbabilityBar` | 5-segment bar; gold ≥0.65 / kindColor 0.35–0.65 / mutedFg <0.35 |
| `EncoreDivider` | Centered tracked label on dashed accent rule |
| `PersonalWeightChip` | `💛 saved` / `🎯 first time` / `⭐ top track` overlays (placeholder shape; library cross-ref data fills in Phase 7) |
| `RotatingSlotCard` | Surprise-slot probabilities (used for Tate's "guest duet" rotation) |

Visual rules per [`../ui-spec.md`](../ui-spec.md) §3 + §3.4–§3.7.

Triggers wired:
- `discover/ingest-performer` → chain `setlist-corpus-fill predict`
  on follow
- `shows-nightly` → enqueue `setlist-corpus-fill predict` for
  performers with watching shows in next 30 days
- Show detail page open → debounced corpus refresh if stale

---

## Tests

### Unit

- `packages/api/src/__tests__/setlist-predict.test.ts` — synthetic
  corpora at each tier mix; Bayesian-smoothing math; active-tour
  anchor; one-off suppressor; confidence calibration
- `packages/jobs/src/__tests__/setlist-corpus-fill.test.ts` — mode
  paging budgets; tour-id synthesis; tour-leg extraction
- `packages/jobs/src/__tests__/song-index-rebuild.test.ts` —
  idempotency: run twice, zero duplicates

### Integration

- Seed 4 shows / 3 artists / overlapping titles; assert
  `songsHeardMost` returns expected ordered count
- Seed 60 setlists for Tate McRae; assert `predictedSetlist`
  returns confidence ≥ 0.85 and a 21-song core

### E2E (Playwright)

- `apps/web/tests/predicted-setlist.spec.ts` — open a stable-style
  show, see spoiler curtain, tap reveal, assert ≥18 song rows with
  probability bars

---

## Observability events

- `setlist.corpus_fill.{started,complete,failed}`
- `setlist.song_index.{built,partial,failed}`
- `setlist.predict.served` (payload: `confidence`, `style`, `sample_size`)
- `setlist.predict.{cache_hit,cache_miss}`

---

## Exit criteria

1. For a synthetic seeded user with 3 followed artists, the
   predicted-setlist tab loads on a `watching` show in <500ms.
2. The Tate McRae worked example
   ([`../worked-examples.md`](../worked-examples.md) §1) renders the
   documented confidence (≥0.90) and a 21-song core with the
   guest-duet rotation surfaced separately.
3. `pnpm verify:e2e` includes the spoiler-curtain reveal flow.
4. `pnpm verify:coverage` passes — both web and mobile coverage
   gates green.
5. The corpus-fill cron runs cleanly for 7 consecutive days on the
   prod DB without busting setlist.fm rate limits.

---

## What this phase does NOT include

- Mobile parity (Phase 10)
- Spotify export buttons (Phase 3)
- The Songs page or per-song detail (Phase 2)
- Style classifier or rotating display (Phase 5)
- The eval harness (Phase 4 — runs in shadow mode after this phase)
- Personal-weight chip backing data (Phase 7 — chips render with no
  data in this phase, displayed as placeholders)

---

## Suggested PR breakdown

A natural three-PR split for this phase:

1. **Schema + jobs** — corpus-fill + song-index-rebuild + backfill
   script. No UI. Verifiable via the integration tests.
2. **Algorithm** — `setlist-predict.ts` + tRPC procedures + cache.
   Verifiable via unit + integration tests.
3. **Web UI** — predicted-setlist tab + components +
   `SegmentedControl` integration. Verifiable via Playwright.
