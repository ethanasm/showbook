# Phase 5 — Style classifier + rotating-style display

> **Goal.** The Phish case end-to-end. Auto-classify performers
> into the four setlist styles, ship the rotating-style display
> (gap chart + position pools + multi-night anti-repeat), turn on
> the calibration release gate from Phase 4.

| Estimated effort | ~2 weeks |
| Critical path? | Yes for non-stable artists |
| Prerequisites | Phases 1, 4 |
| Ships | Rotating-style predicted-setlist display on web; the calibration gate is enforced from this point |

References:
- [`../feature-plan.md`](../feature-plan.md) §15b (classifier),
  §15c (gap-based prediction), §15d (position pools), §15e (multi-
  night runs)
- [`../worked-examples.md`](../worked-examples.md) §2 (Phish)
- [`../ui-spec.md`](../ui-spec.md) §4.1 (rotating UI)

---

## Code

### `packages/api/src/setlist-style.ts` (new)

```ts
export function inferStyle(corpus: Corpus): SetlistStyle {
  if (corpus.size < 5) return 'unknown';

  const jaccard      = meanPairwiseJaccard(corpus);
  const uniqueRatio  = uniqueSongs / totalSlots;
  const setlistLen   = mean(corpus.map(s => s.songCount));

  if (jaccard >= 0.75 && uniqueRatio < 0.3)  return 'stable';
  if (jaccard <= 0.45 && uniqueRatio > 0.5)  return 'rotating';
  if (jaccard >= 0.95 && uniqueRatio < 0.1)  return 'theatrical';
  if (setlistLen < 6 || corpus.every(noTrackedSongs)) return 'improvised';
  return 'stable';                              // safe default
}
```

### `packages/api/src/setlist-style-seeds.ts` (new)

Curated seed list of ~30 well-known artists by MBID that *we know*
are rotating- or improvised-style (Phish, Pearl Jam, Springsteen,
Dead & Co, Goose, Umphrey's, Wilco, …) plus theatrical (residency
artists). The seeds are applied at first observation; the
auto-classifier doesn't override a seed until it disagrees three
runs in a row (per [`../implementation.md`](../implementation.md)
§11 Q3).

### `packages/jobs/src/setlist-style-refresh.ts` (new)

Nightly cron at 03:00 ET. For each performer with ≥5 corpus
setlists, recompute style and write `performers.setlist_style` +
`performers.setlist_style_inferred_at`.

### `packages/api/src/setlist-predict-rotating.ts` (new)

The §15c gap-based prediction model. Inputs match
`predictSetlist`; output is `RotatingPredictedSetlist`:

```ts
interface RotatingPredictedSetlist {
  style: 'rotating';
  due:               OverdueSong[];
  hot:               OverdueSong[];
  bustoutCandidates: OverdueSong[];
  positions:         PositionPool[];
  setCountPrediction: { sets: 1|2|3; confidence: number };
  multiNightContext: MultiNightContext | null;
  copy: string;
  confidence: number;
  ...
}
```

Pulls per-song `current_gap_shows` / `historical_mean_gap`
(populated by Phase 0's nightly job; see also `packages/jobs/src/song-gap-refresh.ts`
below). Computes:

- `due` — `overdue_score ≥ 1.5`, top 30
- `hot` — played in ≥40% of last 10 setlists
- `bustoutCandidates` — `overdue_score ≥ 3` AND
  `historical_play_count ≥ 5`

### `packages/api/src/multi-night-run-detector.ts` (new)

```ts
export async function detectMultiNightRun(
  performerId: string,
  targetDate: string,
  venueId?: string,
): Promise<RunContext | null>;
```

Detects same-venue consecutive-night runs from the corpus. When
firing on a rotating-style prediction, applies a 0.05 multiplier
to songs already played earlier in the run (effectively excluding
them).

Multi-night-run detection through our `venues` table when possible;
falls back to fuzzy matching `tour_setlists.venue_name_raw` + city
when not. See [`../implementation.md`](../implementation.md) §11 for
the venue-resolution strategy.

### `packages/api/src/routers/setlist-intel.ts` (extend)

Existing `predictedSetlist({ showId })` becomes a discriminated
union switcher:

```ts
import { getHeadlinerId } from '@showbook/shared'; // packages/shared/src/show-accessors.ts

predictedSetlist: protectedProcedure
  .input(z.object({ showId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    // `shows` doesn't carry a denormalized headliner column — performers
    // attach via the `show_performers` join table with role + sortOrder.
    // `getHeadlinerId` walks the canonical 3-tier fallback
    // (role='headliner' + sortOrder=0 → any 'headliner' → first row).
    // Production shows (theatre/festival with a productionName)
    // intentionally return undefined: they don't have a performer-
    // anchored predicted setlist and route to cold-empty-state instead.
    const show = await loadShow(ctx, input.showId);
    const performerId = getHeadlinerId(show);
    if (!performerId) return coldEmptyState({ reason: 'no_performer' });
    const performer = await loadPerformer(performerId);
    if (!performer.setlistStyle) return coldEmptyState(performer);

    switch (performer.setlistStyle) {
      case 'stable':       return predictStable({ ... });
      case 'rotating':     return predictRotating({ ... });
      case 'theatrical':   return predictTheatrical({ ... });   // P6
      case 'improvised':   return predictImprovised({ ... });   // P6
    }
  })
```

### `packages/jobs/src/song-gap-refresh.ts` (new)

Nightly job updating `songs.current_gap_shows` and
`historical_mean_gap` per performer. Cheap walk over
`setlist_song_appearances` ordered by date.

### Web UI

`apps/web/components/predicted-setlist/` (new components):

- **`MultiNightContextBanner`** — full-width banner showing
  "Night N of M at [venue]" with expandable list of already-played
  songs
- **`ShowModeOddsCard`** — set count + length prediction
- **`GapChartRow`** — title + horizontal overdue bar + gap stats
- **`PositionPoolCard`** — slot label + ranked candidate list with
  played-this-run songs at reduced opacity + `⛌` strike
- **`BustoutCandidateRow`** — `✨` prefix + fine-print historical
  context

The show-detail predicted-setlist segment becomes a switcher on
`prediction.style`:

```tsx
function PredictedSetlistView({ prediction }: { prediction: PredictedSetlistUnion }) {
  switch (prediction.style) {
    case 'stable':       return <StablePrediction prediction={prediction} />;
    case 'rotating':     return <RotatingPrediction prediction={prediction} />;
    case 'theatrical':   return <TheatricalPrediction prediction={prediction} />;  // P6
    case 'improvised':   return <ImprovisedPrediction prediction={prediction} />;  // P6
    case 'cold':         return <ColdEmptyState prediction={prediction} />;
  }
}
```

---

## Tests

### Unit

- `packages/api/src/__tests__/setlist-style.test.ts` — synthetic
  corpora at each style boundary; seed-list overrides; three-runs-
  to-disagree behavior
- `packages/api/src/__tests__/setlist-predict-rotating.test.ts` —
  gap math, overdue ranking, position-pool entropy
- `packages/api/src/__tests__/multi-night-run-detector.test.ts` —
  venue match through `venues` table; fallback to raw matching;
  consecutive-night detection edge cases

### Integration

- Phish worked example
  ([`../worked-examples.md`](../worked-examples.md) §2) renders
  documented gap chart + position pools + multi-night exclusions
  against a seeded 8-night Sphere fixture
- For a tour with all 3+ nights at one venue, multi-night detection
  fires automatically

### E2E (Playwright)

- `apps/web/tests/predicted-setlist-rotating.spec.ts` — open a
  rotating-style show with seeded corpus → assert gap chart rows
  + position pool cards + banner are visible

---

## Observability events

- `setlist.style.classified` (payload: performerId, oldStyle,
  newStyle, jaccard, uniqueRatio)
- `setlist.style.seed_applied`
- `setlist.style.seed_overridden`
- `setlist.run_detection.{matched,not_found}`
- `setlist.predict.served` already exists; `style` field carries
  the new variant

---

## Exit criteria

1. Phish worked example renders the documented output against a
   seeded 8-night Sphere fixture.
2. Multi-night run detection catches a 3-night residency
   automatically and excludes prior-night songs.
3. The "Tweezer Reprise" `★ DUE` chip annotation surfaces
   correctly when a song is in both the Due list and the encore-
   close pool.
4. `setlist-style-refresh` cron has been running cleanly for 7
   consecutive days.
5. **The calibration release gate from Phase 4 is now enforced.**
   Stable-style Brier ≤ 0.15; rotating-style precision-at-10 ≥
   0.4; per-bin calibration error ≤ 20pp.
6. The mode-switch on `prediction.style` works with `cold` empty-
   state for performers below the corpus threshold.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Style classifier flip-flops | Three-runs-to-disagree on seed entries; auto-classifier requires ≥5 corpus setlists; manual override field |
| Multi-night-run false positives (same venue, weeks apart) | Require *consecutive* dates within the prior 7 days |
| Multi-night-run false negatives (same venue, weeks apart, scattered shows) | Acceptable — those aren't really "runs" |
| Rotating-style display too dense for phone | Phase 10 designs the mobile variant separately |
| Rotating-style confidence consistently fails the calibration gate | The model is right but the data is just hard; lower the gate threshold for rotating-style or accept that v1 ships with rotating-style at lower quality and document it |

---

## What this phase does NOT include

- Theatrical or improvised display variants (Phase 6)
- Special-event rules (Halloween, NYE) — that's Phase 11
- Mobile rotating display (Phase 10)
- Conditional / pair patterns (deferred per
  [`../feature-plan.md`](../feature-plan.md) §15s)
- Album-drop forward signal (Phase 11)
