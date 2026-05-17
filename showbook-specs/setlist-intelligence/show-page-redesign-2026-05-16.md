# Show-page redesign — 4-tab system (2026-05-16)

This document supersedes large parts of
[`ui-spec.md`](ui-spec.md) for the show-detail page. It captures
the design handoff in [`/design/show-page-tabs/`](../../design/show-page-tabs/)
and re-scopes the affected phases (1, 2, 3, 7, 8, 9, 10).

**The handoff itself:** drop
`/design/show-page-tabs/Show Page Tabs.html` into a browser. Pure
CDN React + Babel-standalone, no build. JSX source under
`/design/show-page-tabs/show-tabs/`. Tokens at
`/design/show-page-tabs/hifi/sb-tokens.jsx`. The
[handoff README](../../design/show-page-tabs/README.md) is the
canonical reading order.

---

## What changed

### Before (original ui-spec)

Show detail was a vertical stack. Setlist intelligence added a
`SegmentedControl` with three segments: `Setlist · Predicted ·
Songs`. The predicted-setlist tab was a new screen mounted into
that segment. Music-layer (vibe radar, fan-loyalty, etc.) lived
as separate cards stacked between setlist and photos.

### After (this redesign)

> **Update 2026-05-17 — Phase 8 deferred to v2.** The audio-features
> probe returned 403, so VibeRadar / EnergyArc are dropped from v1.
> Wherever this doc mentions them below, treat the slot as **empty
> (right rail)** or **omitted (tab body)** for the v1 rollout. The
> rest of the redesign is unchanged.

Show detail becomes a **4-tab page**, always in this order:

| Tab | Pre-show (v1) | Post-show (v1) |
|---|---|---|
| **Overview** | Stats · lineup · history · actions | Stats · lineup · fan loyalty · "went" badge |
| **Setlist** | Confidence % · Hype Playlist card · likely setlist (2-col) | Songs count · "I Heard" playlist card · setlist with library flag · discovered-live rail |
| **Media** | Empty + "what we'll add automatically" | Photo grid · ticket stub · live playlist · press recap |
| **Notes** | Pre-show prompts | Post-show recap prompts |

(Original-design table with the vibe-radar / energy-arc cells is
preserved in the Phase 8 spec for v2 reference.)

Tab labels never change — muscle memory survives the show
transition. **What changes is the badge** on each tab:
confidence (`92%`) pre-show on Setlist, count (`16`) post-show.

The hero shrinks but never disappears. Tab bar is sticky. Stats
collapse 4-col → 2×2 below 480px.

**Music-layer is woven into the tabs**, not stacked beside them.
- ~~`VibeRadar` (7-axis) — Overview tab (past) + Setlist tab (pre + post)~~ — **deferred v2**
- ~~`EnergyArc` (per-track bar chart with encore divider) — Setlist tab~~ — **deferred v2**
- `HypePlaylistCard` (hero card with branded cover) — Setlist tab top
- `FanLoyaltyRing` — Overview tab (past)
- `DiscoveredRail` — Setlist tab (past, list rows with save buttons)
- `PrimingStat` — italic line in the title block (past)
- `TrackPreview` — inline 30s-preview button on every setlist row

There is also a **right rail** on desktop (≥1200px). In v1 it pins
only `HypePlaylistCard` (pre-show) and `FanLoyaltyRing` (post-show).
VibeRadar / EnergyArc were the planned third + fourth atoms but are
deferred to v2 — see the right-rail ownership table below for the
v1 state vs. the v2 plan. The rail is hidden below 1200px; the
remaining atoms appear inline in the tabs instead.

---

## Tokens (Marquee palette, Space Grotesk + IBM Plex Mono)

The handoff introduces a `window.SB` token set at
[`/design/show-page-tabs/hifi/sb-tokens.jsx`](../../design/show-page-tabs/hifi/sb-tokens.jsx).
Highlights:

- **Type** — `Space Grotesk` for sans, `IBM Plex Mono` for mono.
  (Current Showbook uses Geist Sans / Mono.)
- **Palette** — near-black `#0C0C0C` bg dark, warm-off-white
  `#FAFAF8` bg light. Surface elevated `#141414` / `#1C1C1C` dark.
  Marquee Gold accent `#FFD166` (dark) / `#E5A800` (light), with
  faded variants.
- **Per-kind accents** — `kinds.concert.inkDark = #3A86FF`
  (stage blue), `theatre = #E63946` (curtain crimson), `comedy
  = #9D4EDD` (amethyst), `festival = #2A9D8F` (outdoor teal).

**Decision (binding for the redesign rollout):** adopt the new
tokens. Geist → Space Grotesk, current accent → Marquee Gold.
The token swap lands in Phase 1 alongside the show-page rebuild
because the new components are designed against it. Existing
pages keep working — Tailwind / CSS-variable wiring stays the
same; only the variable values change. A theme-swap PR ahead of
Phase 1 surfaces any contrast issues across the existing app.

---

## Tab-badge ownership across phases

The badge on each tab is shared state that multiple phases
populate. To keep the contract clear:

| Tab | Badge content | Source | Phase that wires it |
|---|---|---|---|
| Overview | none | — | Phase 1 (tab shell) |
| Setlist | pre-show: confidence % | `setlistIntel.predictedSetlist` → `prediction.confidence` | Phase 1 |
| Setlist | post-show: song count | `shows.setlists` flattened | Phase 1 (display only, data exists today) |
| Media | photo count | `mediaAssets` filtered to show | Phase 1 (display only) |
| Notes | `·` indicator if non-empty | `shows.notes` | Phase 1 |

---

## Right-rail ownership

The right-rail is a single component (`<ShowDetailRightRail>`)
that takes the show + music-layer payload and renders the
appropriate atoms based on show state. **Phase 1 ships the rail
shell as an empty container** so future phases can drop atoms in
without re-plumbing layout.

| Atom | Phase that ships data + visual | v1 state |
|---|---|---|
| `VibeRadar` (post-show, actual) | ~~Phase 8~~ — **deferred v2** | empty slot |
| `VibeRadar` (pre-show, predicted) | ~~Phase 8~~ — **deferred v2** | empty slot |
| `EnergyArc` (post-show, actual) | ~~Phase 8~~ — **deferred v2** | empty slot |
| `EnergyArc` (pre-show, predicted) | ~~Phase 8~~ — **deferred v2** | empty slot |
| `HypePlaylistCard` (pre-show) | Phase 3 | shipping |
| `FanLoyaltyRing` (post-show) | Phase 7 | shipping |
| Hide entirely when no atoms apply | Phase 1 (shell logic) | shipping — without VibeRadar/EnergyArc the rail hides for many show states |

---

## Per-phase impact summary

### Phase 1 — **major rework** (was: "Predicted segment on existing show detail")

**New Phase 1 scope:**
- Token swap: Geist → Space Grotesk + Marquee Gold (separate PR ahead of the tab work).
- Ship the **4-tab shell** for `/(app)/shows/[id]/` — `<ShowTabs>` with Overview / Setlist / Media / Notes; sticky tab bar; URL param `?tab=…` for routing; ~120ms crossfade on tab change.
- Wire **Overview tab content** (stat row + lineup + history + actions). The "went" badge for past shows. Pre-show shows the music-layer slot for `FanLoyaltyRing` as an empty placeholder ("we'll fill this in once your Spotify is connected"). (The VibeRadar slot from the original design is dropped — Phase 8 deferred to v2.)
- Ship **Setlist tab content for stable-style artists** (the bulk of the original Phase 1 work, but slotted into the Setlist tab instead of a SegmentedControl):
  - Pre-show: confidence banner + `<HypePlaylistCard placeholder />` (real card lands in Phase 3) + predicted setlist (2-col on wide, 1-col on compact) + `EncoreDivider` + ★ openers/closers + per-row evidence ("12/12").
  - Post-show: count banner + actual setlist + `EncoreDivider` + ★ markers.
- Ship **Media tab + Notes tab placeholder content** so the tab navigation works end-to-end. Media uses the existing photo grid + the "what we'll add automatically" stubs from the handoff. Notes uses the prompts from the handoff.
- Ship the **right-rail shell** (empty container with the slot logic for which atoms render in which state).
- Tab badges per the table above.
- Drop the old `SegmentedControl` (`Setlist · Predicted · Songs`) entirely. The Songs subsection moves to Phase 2's `/songs` page.

**Phase 1 still includes:** the corpus-fill + song-index-rebuild jobs, the algorithm, the tRPC procedures (`predictedSetlist`, `songsHeardMost`, `setlistDiff`, `firstTimes`), and the `loadCorpusForPrediction` `REPEATABLE READ` wrapper. No change there.

### Phase 2 — **minor adjustment**

- Drop the "Songs segment on Show detail" item from the brief (it was the third segment in the old SegmentedControl). The Show detail no longer has a Songs segment; song badges (🆕, 🎯) appear inline on the Setlist tab's track rows instead, as designed.
- `/(app)/songs/` page + per-song detail + artist-page extensions are unchanged.

### Phase 3 — **adjustment** (Hype button → HypePlaylistCard)

- The "Hype playlist on Spotify" button in the original spec becomes the **`<HypePlaylistCard>` hero** at the top of the Setlist tab (pre-show). Designed shape: branded cover at left, "Spin up N songs you'll hear" + "~92 min · ordered like the show · drops onto your Spotify" copy, two buttons ("Open in Spotify" primary + "Preview here" secondary).
- "Save tonight to Spotify" (post-show) becomes a parallel card in the same Setlist-tab top slot — same shape, different label ("I Heard No Doubt").
- The Phase 3 hide-rule (`setlistStyle === 'rotating'` hides the card) still applies; lands in Phase 5.

### Phase 4 — no UI impact

(Eval harness is admin-only `/admin/eval` page; unchanged.)

### Phase 5 — **adjustment** (rotating display targets the Setlist tab)

- The rotating-style display variant (`GapChartRow`, `PositionPoolCard`, `MultiNightContextBanner`, `BustoutCandidateRow`) replaces the **likely setlist** section content inside the Setlist tab when `prediction.style === 'rotating'`. Hero / confidence banner / `HypePlaylistCard` (hidden for rotating per SI-05) live above the same way.

### Phase 6 — **adjustment** (theatrical + improvised displays target the Setlist tab)

- Theatrical (`ActDivider`, `RotatingSlotCard`) and improvised (`VibeSketchCard`, `ShowModeOddsCard`) variants of the Setlist-tab body.

### Phase 7 — **adjustment** (rail atoms move to Overview + right-rail)

- `FanLoyaltyRing` lands in the **Overview tab** (past shows) as designed + on the **right rail** (desktop).
- `DiscoveredRail` lands in the **Setlist tab** (past) as a list-row layout per the handoff (not the originally-spec'd horizontal-scroll rail).
- `PrimingStat` becomes the italic line **in the show title block** (not a standalone one-liner section).
- Year-end soundtrack + library cross-reference logic unchanged.

### Phase 8 — **DEFERRED to v2** (audio-features probe returned 403 on 2026-05-17)

- The SI-11 probe ran on prod 2026-05-17 and Spotify denied access
  to `/audio-features` for our app registration. Per SI-16, Phase 8
  drops from v1 entirely (AcousticBrainz fallback rejected — frozen
  at 2022).
- `VibeRadar`, `EnergyArc`, and set-length-inline are **not shipping
  in v1**. The right-rail slots stay empty for those atoms; the
  inline "Predicted shape" section in the Setlist tab is omitted
  entirely; the title block does not get the `· 1h 47m s on stage`
  segment.
- Phase 8 spec preserved as v2 design reference. Re-probe via
  `pnpm --filter @showbook/api probe-audio-features <userId>` if a
  third-party data source emerges or Spotify reverses the
  deprecation. The `SpotifyAudioFeaturesAvailable` feature flag
  stays in code at OFF so a flip-to-ON via PR is the only thing
  needed to re-enable the work.

### Phase 9 — **adjustment** (previews inline on every track row)

- `<TrackPreview>` (the round 24px ▶ button) ships in Phase 9 and appears as the third column on every setlist track row in the Setlist tab. Phase 1 stubs the placement with an empty 24px slot.

### Phase 10 — **major rework** (mobile parity for the 4-tab system)

- Mobile mirrors the same 4-tab structure (`SegmentedControl` between
  `Overview · Setlist · Media · Notes`).
- Hero collapses to 56-pt sticky strip on scroll (unchanged from the
  original ui-spec).
- iPad three-pane `SetlistLab` becomes the **right pane** that mirrors
  the desktop right rail.

### Phase 11 — no UI impact

(Polish + §15 items.)

---

## Old ui-spec.md status

The original [`ui-spec.md`](ui-spec.md) §3-§7 (Tate McRae screen,
4-style display variants, mobile/iPad/web responsive) is **still
the spec for the inside of each tab**. The 4-tab system this doc
introduces is the OUTER container. Treat:

- `ui-spec.md` §1 (design system grounding) — **superseded** by the
  Marquee-Gold tokens in `/design/show-page-tabs/hifi/sb-tokens.jsx`.
- `ui-spec.md` §2 (component table) — additive; the components
  listed there still ship, but inside the new Setlist tab instead
  of a SegmentedControl.
- `ui-spec.md` §3 (Tate McRae stable-style screen) — content inside
  Setlist tab pre-show. The "spoiler curtain" CTA still applies.
- `ui-spec.md` §4 (rotating/theatrical/improvised variants) — same
  rule, inside Setlist tab.
- `ui-spec.md` §5 (loading/error/empty states) — applies inside
  each tab.
- `ui-spec.md` §6 (mobile/iPad/web variants) — superseded by the
  handoff's responsive strategy (the JSX uses a `compact` prop;
  in production use media queries — the breakpoints are noted in
  the handoff's `components.jsx`).
- `ui-spec.md` §7 (interaction microcopy) — unchanged.

A future cleanup PR can fold this redesign doc into a single
unified `ui-spec.md`. For now, this doc + the handoff are
authoritative for the show-page surface.
