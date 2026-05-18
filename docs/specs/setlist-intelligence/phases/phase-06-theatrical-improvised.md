# Phase 6 — Theatrical + improvised display variants

> **Goal.** The Beyoncé and King Gizzard cases. The other two
> branches of the style switcher.

| Estimated effort | ~1 week |
| Critical path? | No (parallel to Phase 7) |
| Prerequisites | Phase 5 (the switcher and classifier) |
| Ships | Theatrical + improvised display variants on web |

References:
- [`../feature-plan.md`](../feature-plan.md) §15p (display variants)
- [`../worked-examples.md`](../worked-examples.md) §3 (Beyoncé), §4
  (King Gizzard)
- [`../ui-spec.md`](../ui-spec.md) §4.2, §4.3

---

## Code

### `packages/api/src/setlist-predict-theatrical.ts` (new)

```ts
interface TheatricalPredictedSetlist {
  style: 'theatrical';
  deterministicSetlist: { act: string; title: string; p: number }[];
  rotatingSlots: RotatingSlot[];   // Act V "surprise" slot, Act VII "family appearance", etc.
  setLengthPrediction: ShowLengthPrediction;
  ...
}
```

Detection of "rotating slots" within a theatrical setlist:

- For each position in the corpus, compute the song-share
  distribution
- Positions where one song dominates (≥95% share) → fixed
- Positions with 3+ alternates each at 10–35% share → rotating
  slot

Beyoncé Cowboy Carter Tour produces two such slots: Act V surprise
+ Act VII family appearance. The model surfaces them as separate
`RotatingSlot` cards rather than dragging the whole prediction's
confidence down.

### `packages/api/src/setlist-predict-improvised.ts` (new)

```ts
interface ImprovisedPredictedSetlist {
  style: 'improvised';
  setLengthPrediction: {
    showModes: ShowMode[];
    ...
  };
  vibeSketch: {
    headlineDescriptor: string;
    popularPicks: PopularPick[];
    albumsRepresentedRecently: string[];
    knownTendencies: string[];
  };
  copy: string;
  ...
}
```

Show-mode detection: cluster setlist lengths by mode. King Gizzard
has bimodal distribution at ~11 (regular) and ~26 (marathon)
songs. We fit a small mixture model + threshold to get show-mode
probabilities.

Popular picks: songs with `playedShare ≥ 0.25` across last N
shows. No probability number on each — we explicitly refuse
song-by-song prediction. The copy field carries the honest
"we can't predict tonight" message.

Vibe descriptor + tendencies: hand-curated text per artist OR
LLM-generated from corpus stats. v1 ships with hand-curated
strings for the seed-list improvised artists; auto-generation
deferred.

### `packages/api/src/routers/setlist-intel.ts` (extend)

The existing `predictedSetlist` switcher in Phase 5 gains the
`'theatrical'` and `'improvised'` cases that route to the new
prediction modules.

### Web UI

`apps/web/components/predicted-setlist/` additions:

- **`ActDivider`** — same chrome as `EncoreDivider` (Phase 1) but
  uses kindColor and the act number as the centered tracked label
- **`RotatingSlotCard`** — already exists from Phase 1's Tate
  guest-duet rotation; reuse for Beyoncé's Act V surprise +
  Act VII family appearance
- **`ShowModeOddsCard`** — already exists from Phase 5; reuse with
  King Gizzard's three-mode variant (regular / marathon /
  microtonal)
- **`VibeSketchCard`** — new component; descriptor + recent-album
  list + popular picks + tendencies

The style switcher in the show-detail predicted-setlist segment
gains `<TheatricalPrediction>` and `<ImprovisedPrediction>`
branches.

---

## Tests

### Unit

- `packages/api/src/__tests__/setlist-predict-theatrical.test.ts`
  — rotating-slot detection at varying corpus sizes;
  deterministic-act behavior
- `packages/api/src/__tests__/setlist-predict-improvised.test.ts`
  — show-mode mixture fitting on bimodal King Gizzard fixture

### Integration

- Beyoncé worked example renders 9-act program + Act V/VII slot
  cards against a seeded 32-setlist fixture
- King Gizzard worked example renders show-mode card + vibe sketch
  against a seeded multi-mode fixture

### E2E (Playwright)

- `apps/web/tests/predicted-setlist-theatrical.spec.ts` — open a
  theatrical-style show, see the program structure, verify the
  rotating-slot cards
- `apps/web/tests/predicted-setlist-improvised.spec.ts` — open an
  improvised-style show, see no song-by-song list, verify show-mode
  card + vibe sketch + action card with archive pointer

---

## Observability events

No new events. Existing `setlist.predict.served` carries the new
`style` values.

---

## Exit criteria

1. The style switcher in the predicted-setlist segment correctly
   mounts theatrical or improvised displays based on
   `prediction.style`.
2. Beyoncé worked example renders the documented 9-act program
   with both rotating-slot cards.
3. King Gizzard worked example renders the documented show-mode
   probabilities + vibe sketch + action card.
4. Theatrical-style probability bars render in the dampened
   variant per [`../ui-spec.md`](../ui-spec.md) §4.2 (every row is
   5/5; eye is drawn to the rotating slots, not the core).

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Rotating-slot detection over-eager (flags any minor variation) | Tight thresholds: ≥3 alternates each between 10–35% share; <95% top-song dominance |
| Improvised-style "vibe descriptor" generation feels robotic | v1 ships with hand-curated descriptors for seed-list artists only; auto-generation via LLM is a Phase 11 stretch |
| Theatrical "rotating slot" misclassification (surprise slot vs. genuine variation) | Rely on Phase 5's classifier — if the artist is theatrical, the *rest* of the setlist is fixed; rotating slots are the small variance |
| Multi-leg theatrical tours (different setlists per leg) | Tier-A weighting in the parent algorithm already handles this — each leg's setlist version dominates its own time window |

---

## What this phase does NOT include

- Mobile parity (Phase 10)
- Special-event detection (Phase 11; covers Halloween-Phish-style
  shows that *break* the theatrical pattern)
- Per-act time-of-night prediction
- Family-appearance prediction beyond raw share
- LLM-generated vibe descriptors (deferred to Phase 11 stretch)
