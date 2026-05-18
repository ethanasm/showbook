# Phase 10 — Mobile parity + iPad three-pane

> **Goal.** Every web surface from Phases 1, 2, 3, 5, 6, 7, 8, 9
> mirrored on phone + iPad. The Phase 0 connect modal already shipped
> the `SpotifyConnectSheet` mobile mirror; this phase adds every
> other piece.

| Estimated effort | ~1 week |
| Critical path? | No (parallels late phases) |
| Prerequisites | Phases 3, 5, 6 minimum; for full parity also 7, 8, 9 |
| Ships | Predicted-setlist + per-song detail + Songs power view + iPad three-pane SetlistLab |

References:
- [`../ui-spec.md`](../ui-spec.md) §6 (responsive)
- [`../feature-plan.md`](../feature-plan.md) §12 (mobile/tablet/visuals)

---

## Code

### `apps/mobile/app/show/[id].tsx` (edit)

Add a `SegmentedControl` at the top of the show detail with
`Setlist · Predicted · Songs`. Default segment is `Predicted` for
watching/ticketed shows when a prediction exists.

The Predicted segment mounts the style switcher:

```tsx
function PredictedSetlistView({ prediction }: { prediction: PredictedSetlistUnion }) {
  switch (prediction.style) {
    case 'stable':       return <StablePrediction prediction={prediction} />;
    case 'rotating':     return <RotatingPrediction prediction={prediction} />;
    case 'theatrical':   return <TheatricalPrediction prediction={prediction} />;
    case 'improvised':   return <ImprovisedPrediction prediction={prediction} />;
    case 'cold':         return <ColdEmptyState prediction={prediction} />;
  }
}
```

Each branch is a separate component file under
`apps/mobile/components/predicted-setlist/`.

### Mobile components

Mirror every component from
[`../ui-spec.md`](../ui-spec.md) §2 to mobile:

- `PredictionHero` — confidence dial + tour metadata + set-shape
  strip; collapses to 56-pt sticky strip on scroll
- `SpoilerCurtain` — same three CTAs as web; choice persists in
  expo-secure-store per show
- `PredictionSongRow` — workhorse row component
- `ProbabilityBar` — same 5-segment rules
- `EncoreDivider` / `ActDivider`
- `PersonalWeightChip` — pulls from cached `user_spotify_saved_tracks`
- `RotatingSlotCard` (universal use)
- `MultiNightContextBanner` (rotating)
- `GapChartRow` (rotating)
- `PositionPoolCard` (rotating)
- `BustoutCandidateRow` (rotating)
- `ShowModeOddsCard` (rotating, improvised)
- `VibeSketchCard` (improvised)
- ~~`VibeRadar` (Phase 8 surfaces; mobile uses simpler 4-axis variant)~~ — **deferred v2** (P8 dropped after 2026-05-17 probe 403)
- ~~`EnergyArc` (Phase 8 surfaces; mobile uses inline sparkline)~~ — **deferred v2**

All components compose the existing mobile primitives (`Sheet`,
`SegmentedControl`, `Skeleton`, `Banner`, `Toast`).

### `apps/mobile/app/song/[id].tsx` (new)

Per-song detail screen — same shape as the web version (Phase 2).

### `apps/mobile/app/songs/index.tsx` (new — iPad-focused)

Songs power view. Uses `ThreePaneLayout` when `useBreakpoint() ===
'tablet'`:

```
[Filters | Sortable table | Selected song detail]
```

On phone (≤900pt window), this collapses to a single-column table
with tap-to-detail navigation. The iPad three-pane is the genuinely
new surface this phase introduces.

### `apps/mobile/app/(tabs)/index.tsx` (edit)

Home rails for setlist intelligence:

- **Tonight's predicted setlist** — when user has a `ticketed`
  show with `date = today`. Card with artist + 3 sample songs +
  "Open hype playlist" CTA.
- **Rare catches** — collapsed-by-default rail; expanded if user
  has ≥3 rare catches.

Both feed from `useCachedQuery` so they paint instantly on cold
start.

### iPad three-pane integration

The existing `apps/mobile/components/ThreePaneLayout.tsx` doesn't
need changes; the show-detail screen consults it via
`useSelectedShow()` already.

The right pane (`SetlistLab`) gets its predicted-setlist content:

```
┌── iPad: Show detail (concert) ────────────────────────────────────┐
│ Shows list   │ Show detail              │ Setlist Lab             │
│ [list]       │ [middle pane content]    │ Predicted setlist       │
│              │                          │ Setlist diff            │
│              │                          │ Spotify export card     │
└──────────────┴──────────────────────────┴─────────────────────────┘
```

A `SegmentedControl` at the top of the right pane switches between
Map (existing) and Setlist Lab. Persists choice per session.

### Mobile cache + outbox additions

`apps/mobile/lib/cache/outbox.ts` (edit) — add new mutation kinds:

```ts
type PendingMutation =
  | 'shows.create'
  | 'shows.update'
  | 'shows.delete'
  | 'shows.updateState'
  | 'shows.setSetlist'
  | 'setlistIntel.exportPlaylistPredicted'    // new
  | 'setlistIntel.exportPlaylistAttended'     // new
  | 'setlistIntel.saveDiscoveredSong';        // new
```

Each new mutation gets a handler in `apps/mobile/lib/mutations/`
that calls the corresponding tRPC procedure.

### `apps/mobile/components/SpotifyConnectSheet.tsx` (already from P0)

No changes — works for every mobile Spotify entry point because
of the shared `useSpotifyConnection` hook.

### Mobile Spotify-follow rail

Mobile equivalent of the Phase 9 web rail lands on the Discover
tab. Reuses the existing horizontal-rail pattern from followed
venues / artists.

---

## Tests

### Unit

- `apps/mobile/lib/__tests__/predicted-setlist-cards.test.ts` —
  card-rendering shape per style
- `apps/mobile/lib/__tests__/spotify-export-mobile.test.ts` —
  outbox-aware mutation behavior (replay on reconnect, partial-
  success toast)

### Maestro E2E

- `apps/mobile/e2e/flows/predicted-setlist.yaml` — open a show on
  Android, see the predicted segment, navigate styles
- `apps/mobile/e2e/flows/spotify-export.yaml` — first tap on Hype
  surfaces the connect sheet; OAuth (mock); export fires;
  subsequent tap goes straight through

---

## Observability events

No new structured events — mobile reuses everything from web. Mobile-
specific log context: `child({ component: 'mobile.predicted-setlist' })`.

---

## Exit criteria

1. Predicted segment renders on iPhone, iPad, and Android sample
   devices for all four styles plus cold.
2. iPad three-pane SetlistLab right pane shows on a concert show
   detail with the predicted-setlist + setlist diff + Spotify
   export card stacked.
3. Maestro flows pass on Android CI.
4. iOS simulator walk-through passes (manual; documented in the
   PR description).
5. Mobile Spotify export uses the outbox correctly — kill the app
   mid-export and verify the mutation replays on relaunch.
6. **SI-08 (deferred from Phase 0) is validated.** Manually walk
   the Connect Spotify flow on both iOS and Android: tap a Hype
   playlist / Save-tonight button on Show detail → the
   `SpotifyConnectSheet` slides up → tap Connect → Spotify OAuth
   in the in-app browser → approve → **in-app browser must
   auto-dismiss** after the HTTPS callback. If it doesn't on iOS
   (ASWebAuthenticationSession doesn't intercept HTTPS redirects
   without universal-link config), implement the fallback:
   register a `showbook://spotify-connected` URL scheme, redirect
   to it from the callback for in-app-browser User-Agents, and
   pass that scheme as the `redirectUrl` to
   `WebBrowser.openAuthSessionAsync`. See
   [`../plan-review.md`](../plan-review.md) SI-08 for the full
   rationale.

---

## Risks

| Risk | Mitigation |
|------|-----------|
| iPad three-pane right pane competes for space with map | SegmentedControl at top of right pane lets user switch |
| ~~Mobile vibe radar is unreadable at phone width~~ | N/A in v1 — Phase 8 deferred after 2026-05-17 probe 403; revisit in v2 |
| Outbox handlers diverge from web semantics | Shared mutation handlers in `apps/mobile/lib/mutations/` mirror server-side validation; integration tests run both surfaces |
| Push notifications not yet wired (root planned-improvements item) | Tonight's predicted setlist + year-end soundtrack send via email today; push wiring is a separate effort tracked outside this plan |

---

## What this phase does NOT include

- Live Activities for streaming responses (out of scope)
- Apple Watch complications (out of scope)
- Offline-first prediction (predictions require network; cached
  ones are surfaced when offline but new ones don't compute on
  device)
- Mobile-only display innovations beyond what the web has
