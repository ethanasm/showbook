# Setlist intelligence — UI specification

Companion to `feature-plan-setlist-intelligence.md` (algorithm) and
`feature-plan-setlist-intelligence-worked-examples.md` (per-style
example outputs).

This doc is the *visual design* for what those algorithm outputs
actually look like on screen. Every component name maps to a real
file path under `apps/mobile/components/` or
`apps/web/components/design-system/`. New components are flagged
**NEW**; everything else is reuse.

---

## 1. Design system grounding

The whole feature lives inside the existing design language: cream
ink (`colors.ink`) on near-black bg (`colors.bg`), gold accent
(`colors.accent`), kindColor per show kind, Geist Sans for body text,
Georgia for hero titles, tracked uppercase labels (`TRACKED`, 0.5em
spacing) for section headers.

**Token reuse — no new tokens.** Probability bars, evidence chips,
encore dividers, and gap-chart bars all compose from:

| Token | Use here |
|-------|---------|
| `colors.bg` | screen background |
| `colors.surface` | hero card, pool cards, banners |
| `colors.ink` | song titles, hero numerals |
| `colors.mutedFg` | row metadata ("14 of 14", role labels) |
| `colors.rule` | row separators, prob-bar track |
| `colors.accent` | high-probability fill (≥ 0.65), CTAs |
| `colors.kindColor.concert` | mid-probability fill (0.35–0.65), encore divider stroke |
| `colors.error` / `colors.success` | diff +/− rows; W/L scoreboard |
| Type ramp `display` | confidence number (Georgia, 56pt) |
| Type ramp `label-track` | "MISS POSSESSIVE TOUR" labels |
| Type ramp `body` | song titles |
| Type ramp `caption` | row metadata |

**Spacing.** All vertical rhythm uses the existing 4-pt SPACING grid
(`SPACING.xs/sm/md/lg/xl/2xl` from `theme-utils.ts`). Card radius
14pt (`RADII.md`); pill radius 999pt (`RADII.full`); inner row
padding 16pt (`SPACING.lg`).

---

## 2. Components introduced for this feature

| Component | File | Used by |
|-----------|------|---------|
| **NEW** `PredictionHero` | `components/PredictionHero.tsx` | All four styles — confidence dial + tour metadata + set-shape strip |
| **NEW** `SpoilerCurtain` | `components/SpoilerCurtain.tsx` | Stable / theatrical — covers titles until tap |
| **NEW** `PredictionSongRow` | `components/PredictionSongRow.tsx` | Stable / theatrical — title + prob bar + role + chips |
| **NEW** `ProbabilityBar` | `components/ProbabilityBar.tsx` | Inside `PredictionSongRow`; reused in pool cards |
| **NEW** `EncoreDivider` | `components/EncoreDivider.tsx` | Stable / theatrical |
| **NEW** `ActDivider` | `components/ActDivider.tsx` | Theatrical only — "ACT III" tracked label |
| **NEW** `RotatingSlotCard` | `components/RotatingSlotCard.tsx` | Stable / theatrical — surprise-slot probabilities |
| **NEW** `GapChartRow` | `components/GapChartRow.tsx` | Rotating only — overdue bar + gap stats |
| **NEW** `PositionPoolCard` | `components/PositionPoolCard.tsx` | Rotating only — slot pool with shares |
| **NEW** `MultiNightContextBanner` | `components/MultiNightContextBanner.tsx` | Rotating + multi-night runs |
| **NEW** `BustoutCandidateRow` | `components/BustoutCandidateRow.tsx` | Rotating only |
| **NEW** `ShowModeOddsCard` | `components/ShowModeOddsCard.tsx` | Improvised + Phish (set count) |
| **NEW** `VibeSketchCard` | `components/VibeSketchCard.tsx` | Improvised |
| **NEW** `PersonalWeightChip` | `components/PersonalWeightChip.tsx` | All — `💛 saved` / `🎯 first time` / `⭐ top track` overlays |
| `Sheet` | (existing) | Editing setlist override; switching segments |
| `SegmentedControl` | (existing) | Tab between Predicted / Setlist (when both exist) |
| `Banner` | (existing) | Multi-night context, low-confidence callouts |
| `EmptyState` | (existing) | Cold corpus state |
| `Skeleton` | (existing) | Loading state |
| `Toast` | (existing) | Spotify export + edit confirmations |

**Web mirrors** live under `apps/web/components/design-system/` with
identical names. They render to DOM but compose the same
`HeroCard` / `Pill` / typography primitives the rest of the web app
already uses.

---

## 3. The Tate McRae (Stable) screen — full spec

This is the canonical "predicted-setlist for a watching show"
screen. Every other style is a variant of this layout.

### 3.1. Where it lives

- **Mobile:** `apps/mobile/app/show/[id].tsx` — predicted view is a
  segment of the show-detail screen, switched via the existing
  `SegmentedControl` between `Setlist · Predicted · Songs`.
  `Predicted` is the default segment when `state ∈ {watching,
  ticketed}` and a prediction is available.
- **Web:** new tab on `/(app)/shows/[id]/`, same segment positions.
- **iPad three-pane:** lives in the *right* pane of `SetlistLab`
  (the §12f pane that swaps in for Map when the selected show is
  a concert).

### 3.2. Mobile layout (phone, portrait)

Three vertical zones:

1. **Hero zone** — fixed at top; collapses to a strip on scroll.
2. **Spoiler curtain** (initial) → **Setlist body** (after reveal).
3. **Action bar** — sticky bottom; Spotify CTA + Edit.

```
┌──────────────────────────────────────────┐ ← bg = colors.bg
│ ◀  Tate McRae · MSG · Sep 15            │   TopBar (existing)
│    Setlist · ▎Predicted▎ · Songs         │   SegmentedControl
├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐   │
│ │   ╭─ confidence dial ─╮             │   │ ← PredictionHero
│ │   │       ▰▰▰▰▰        │             │   │   surface bg, RADII.md
│ │   │       ▰▰▰▰▱        │  94         │   │   gold ring on dial
│ │   │       ▰▰▰▰▱        │  /100       │   │   Georgia 56pt for "94"
│ │   ╰────────────────────╯             │   │
│ │                                       │   │
│ │   MISS POSSESSIVE TOUR · STABLE      │   │ ← label-track 11pt
│ │   83 setlists · 14 in last 30 days   │   │ ← caption mutedFg
│ │                                       │   │
│ │   1 SET · ~22 SONGS · ~95 MIN        │   │ ← SET-SHAPE STRIP
│ │                                       │   │   accent dotted rule
│ └────────────────────────────────────┘   │
│                                           │
│ ┌────────────────────────────────────┐   │ ← SpoilerCurtain
│ │   🔒                                 │   │   surface bg
│ │   Spoiler-blur on                   │   │   ink title
│ │                                       │   │
│ │   We hide stable-style setlists by  │   │ ← caption mutedFg
│ │   default. Tap to see tonight.       │   │
│ │                                       │   │
│ │   ┌──────────────────────────────┐  │   │ ← Pressable, accent fill
│ │   │     Show me the show          │  │   │   ink-on-accent text
│ │   └──────────────────────────────┘  │   │
│ │                                       │   │
│ │   Show structure only · Settings     │   │ ← caption, link-style
│ └────────────────────────────────────┘   │
│                                           │
└──────────────────────────────────────────┘
```

### 3.3. After the spoiler reveal

Hero collapses to a 56-pt strip; the curtain disappears; the body
fills the screen.

```
┌──────────────────────────────────────────┐
│ ◀  Tate McRae · MSG · Sep 15            │
│    Setlist · ▎Predicted▎ · Songs         │
├──────────────────────────────────────────┤
│ ▰▰▰▰▰ 94%  MISS POSSESSIVE  1 SET ~95min │ ← collapsed hero
├══════════════════════════════════════════┤
│                                           │
│  CORE · 18 songs                          │ ← label-track section header
│                                           │
│ ┌────────────────────────────────────┐   │
│ │ 01   Miss possessive          ▰▰▰▰▰│   │ ← PredictionSongRow
│ │      OPENER · 14/14                 │   │   ProbabilityBar 5-segment
│ │      ──────────────────────────────│   │   row separator (rule)
│ │ 02   No I'm not in love       ▰▰▰▰▰│   │
│ │      14/14                          │   │
│ │      ──────────────────────────────│   │
│ │ 03   2 hands             💛   ▰▰▰▰▰│   │ ← PersonalWeightChip
│ │      14/14 · saved on Spotify       │   │
│ │      ──────────────────────────────│   │
│ │ ... (rows 04–17 collapsed in spec)  │   │
│ │      ──────────────────────────────│   │
│ │ 18   It's ok I'm ok           ▰▰▰▰▰│   │
│ │      CLOSER · 14/14                 │   │
│ └────────────────────────────────────┘   │
│                                           │
│  ════════════ ENCORE ═══════════         │ ← EncoreDivider
│                                           │   accent dashed rule
│                                           │   "ENCORE" centered
│                                           │   tracked label
│                                           │
│ ┌────────────────────────────────────┐   │
│ │ 19   Just Keep Watching   🎯  ▰▰▰▰▱│   │ ← PersonalWeightChip
│ │      ENCORE OPENS · 13/14           │   │   "🎯 first time"
│ │      Tour debut · Aug 2025          │   │ ← per-row note
│ │      ──────────────────────────────│   │
│ │ 20   Sports car               ▰▰▰▰▰│   │
│ │      14/14                          │   │
│ │      ──────────────────────────────│   │
│ │ 21   greedy                   ▰▰▰▰▰│   │
│ │      ENCORE CLOSES · 14/14          │   │
│ └────────────────────────────────────┘   │
│                                           │
│  ROTATION · maybe tonight                 │ ← label-track section header
│                                           │
│ ┌────────────────────────────────────┐   │ ← RotatingSlotCard
│ │  GUEST DUET                         │   │   surface bg, dashed border
│ │  Tate sometimes brings out a guest. │   │
│ │  Recent surprise:                   │   │
│ │  · "6 Months Later" w/ Megan        │   │
│ │    Moroney  — 1 of 14 shows         │   │
│ └────────────────────────────────────┘   │
│                                           │
├──────────────────────────────────────────┤ ← sticky action bar
│ [ 🎵 Hype playlist on Spotify ]          │   accent fill button
│ [ ✏︎ Edit ]                              │   secondary outline
└──────────────────────────────────────────┘
```

### 3.4. `PredictionSongRow` — the workhorse

```
┌──────────────────────────────────────────────────┐
│ 03   2 hands              💛   ▰▰▰▰▰  ▾          │ ← long-press → evidence
│      14/14 · saved on Spotify                     │ ← caption, mutedFg
└──────────────────────────────────────────────────┘
   ↑    ↑                  ↑       ↑      ↑
   │    │                  │       │      │
   │    Geist 16pt ink     │       │      chevron · expand for evidence
   │                       │       ProbabilityBar (5-segment)
   │                       PersonalWeightChip(s) — variable
   pos number, mutedFg, monospace
```

- Row height: 64pt (two-line variant) when role label or
  personal-weight tag present; 48pt for plain rows.
- `pos` is monospaced via the existing type ramp's tabular variant
  so column-aligned numerals render cleanly.
- Long-press (mobile) / hover (web) reveals an evidence sheet:
  ```
  ┌─ Why we think 2 hands plays tonight ───────┐
  │  Played in 14 of last 14 Miss Possessive   │
  │  shows · always around position 3.         │
  │                                              │
  │  Last played: Sep 12, 2025 · Forum, LA      │
  │  In your library: yes (Spotify)             │
  └──────────────────────────────────────────────┘
  ```
  Uses the existing `Sheet` component, half-height.
- Tap the row → song detail screen
  (`apps/mobile/app/song/[id].tsx`).

### 3.5. `ProbabilityBar` visual rules

Five 12-pt-wide × 4-pt-tall pill segments with 2-pt gaps.

| Probability | Filled segments | Fill color |
|------------|----------------|-----------|
| ≥ 0.85 | 5 | `colors.accent` (gold) |
| 0.65–0.85 | 4 | `colors.accent` |
| 0.50–0.65 | 3 | `colors.kindColor.concert` |
| 0.35–0.50 | 2 | `colors.kindColor.concert` |
| 0.20–0.35 | 1 | `colors.mutedFg` |
| < 0.20 | 0 (track only) | — |

Track color: `colors.rule`. The bar reads at a glance even without
the percentage number — gold = "almost certain," teal/blue = "good
bet," gray = "long shot."

For accessibility: the row's `accessibilityLabel` reads
"2 hands, 99 percent likely, position 3."

### 3.6. `PersonalWeightChip` rules

Inline 22-pt-tall pill, surface bg with 1-pt rule border. Three
variants:

| Chip | Trigger | Icon · color |
|------|---------|--------------|
| `saved` | song matches a `user_spotify_saved_tracks` row | 💛 (kindColor.concert) |
| `first_time` | song.id has no prior `setlist_song_appearances.show_id` for this user | 🎯 (accent) |
| `top_track` | song matches user's Spotify top-50 (long term) | ⭐ (accent) |

Multiple chips stack with 6-pt horizontal gap. Position: between
the song title and the probability bar, right-aligned within the
title row.

### 3.7. `EncoreDivider`

8-pt gap above and below. Single horizontal accent-colored dashed
rule with the word **ENCORE** centered, tracked label, 11pt,
accent ink, surface-bg pill background so the rule appears to pass
behind the label.

```
              ─ ─ ─ ─ ┤  ENCORE  ├─ ─ ─ ─
```

### 3.8. Spoiler curtain interaction

- Default for stable + theatrical styles (per §12 of the algorithm
  plan): curtain is on at first visit.
- Three CTA options:
  1. **Show me the show** (primary) — reveals everything.
  2. **Show structure only** (secondary, link) — reveals row count,
     positions, and confidence bars but replaces titles with
     `█████████` blocks. Lets the user gauge how much variance
     there is without spoiling specifics.
  3. **Settings →** — opens Preferences with the
     `setlist_spoilers` toggle highlighted.
- User's choice persists per-show (NOT per-artist) in
  `expo-secure-store`. Replays correctly on cold start.
- Hero `confidence` and `setLengthPrediction` are *always* visible —
  they're meta, not spoilers.

---

## 4. Other three styles — what differs from §3

For each style, the **header zone** (PredictionHero + collapsed
strip) is identical except for the style label. The **body zone**
is the variation.

### 4.1. Phish (Rotating)

Spoiler curtain off by default — gap charts and pools are
inherently uncertain, nothing to spoil.

Body zones, top-to-bottom:

1. **`MultiNightContextBanner`** (full-width, `Banner` variant):
   ```
   ┌────────────────────────────────────────────┐
   │ ⓘ  Night 9 of 13 at the Sphere             │
   │    137 songs already played this run —     │
   │    they're excluded from tonight's picks.  │
   │                                       [▾]  │
   └────────────────────────────────────────────┘
   ```
   Tap [▾] expands the full played list.

2. **`ShowModeOddsCard`** (set count + length):
   ```
   ┌─ TONIGHT'S SHAPE ─────────────────────────┐
   │  2 sets · ~19 songs · ~165 min · 98%      │
   └────────────────────────────────────────────┘
   ```

3. **DUE** section header. Stack of `GapChartRow`s:
   ```
   ┌─────────────────────────────────────────────┐
   │ Bug                                          │ ← title, ink
   │ ▰▰▰▰▰▰▰▰▰▰  47-show gap · avg 12          │ ← horizontal bar
   │  ↑                                           │   length = overdue_score
   │  GapChartRow's overdue bar — color           │
   │  intensity scaled by overdueScore * 2 (cap)  │
   └─────────────────────────────────────────────┘
   ```
   The overdue bar *length* is the visual center of gravity for
   rotating-style — the equivalent of `PredictionSongRow`'s
   `ProbabilityBar`.

4. **HOT** section — short list of `PredictionSongRow`-style rows
   with frequency rather than probability ("6 of 8 last shows").

5. **BUSTOUT CANDIDATES** section — `BustoutCandidateRow`s with a ✨
   prefix and a fine-print note ("First played in 1985; bustouts
   every ~140 shows").

6. **POSITION POOLS** — three stacked `PositionPoolCard`s
   (opener / set-2 opener / encore close):
   ```
   ┌─ OPENER ─────────────────────────────  ▰▰▰▰▰▰▰▱ entropy 0.78 ─┐
   │  Sample in a Jar           ▰▰▰   12%                          │
   │  AC/DC Bag                 ▰▰▰   11%                          │
   │  Llama                     ▰▰    10%                          │
   │  Wilson                    ▰▰     6%                          │
   │  ─── already played this run ───                              │
   │  Free                      (13%)  ⛌                           │
   │  Suzy Greenberg            ( 8%)  ⛌                           │
   └────────────────────────────────────────────────────────────────┘
   ```
   Played-this-run songs render at reduced opacity with a `⛌` strike
   tag; they're shown so the user can see *why* they're absent from
   the active pool.

7. **ALREADY PLAYED THIS RUN** disclosure — collapsed list of all
   137 songs with their night.

The "DUE + slot-fit double-flag" winner (Tweezer Reprise in our
worked example) gets a special annotation: a small `★ DUE` chip
inside the corresponding pool card row, gold-tinted.

### 4.2. Beyoncé (Theatrical)

Same hero. Spoiler curtain on by default. Body is a sectioned
program rather than a probability list:

```
ACT I                                      ← ActDivider
─────────────────────
01 ▰▰▰▰▰  AMERICAN REQUIEM
02 ▰▰▰▰▰  Blackbird
03 ▰▰▰▰▰  The Star-Spangled Banner

ACT II                                     ← ActDivider
─────────────────────
04 ▰▰▰▰▰  AMERICA HAS A PROBLEM
05 ▰▰▰▰▰  SPAGHETTII
[…]

ACT V — SURPRISE SLOT  ⭐                  ← RotatingSlotCard inline
┌───────────────────────────────────────┐
│ Recent rotation:                       │
│   DAUGHTER                       31%   │ ← inline ProbabilityBar
│   FLAMENCO                       22%   │
│   SMOKE HOUR (interlude variant) 18%   │
│   Crazy In Love (acoustic)       14%   │
│   II HANDS II HEAVEN              9%   │
└───────────────────────────────────────┘

ACT VI                                     ← ActDivider
─────────────────────
[…]

ACT VII — FAMILY APPEARANCE  ❤︎            ← RotatingSlotCard
┌───────────────────────────────────────┐
│  Rumi joins on PROTECTOR        55%    │
│  Blue Ivy joins on BLACKBIIRD   30%    │
│  No family appearance           15%    │
└───────────────────────────────────────┘
```

`ActDivider` is the same chrome as `EncoreDivider` but uses kind-
color (or a designated theatrical-act color) and the act number.

Probability bars on theatrical-style core songs are visually
dampened — they're all 5/5 — so the eye doesn't fixate on them. The
two `RotatingSlotCard`s are where the energy goes.

### 4.3. King Gizzard (Improvised)

Spoiler curtain off. No song-by-song list at all. Body is three
stacked cards:

1. **`ShowModeOddsCard`** — taller variant than Phish's because
   modes here are the headline:
   ```
   ┌─ TONIGHT'S SHAPE ───────────────────────────┐
   │  Regular set       65%   ~11 songs · ~75min │
   │  ▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱                      │
   │                                               │
   │  Marathon set      30%   ~26 songs · ~180min│
   │  ▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱                    │
   │                                               │
   │  Microtonal night   5%   K.G./L.W. material │
   │  ▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱                    │
   └─────────────────────────────────────────────┘
   ```

2. **`VibeSketchCard`**:
   ```
   ┌─ VIBE ──────────────────────────────────────┐
   │  high-energy psych-rock with extended jams  │
   │                                               │
   │  RECENT ALBUMS                                │
   │  · Flight b741 (2024)                        │
   │  · PetroDragonic Apocalypse (2023)           │
   │  · The Silver Cord (2023)                    │
   │                                               │
   │  POPULAR PICKS · ≥25% of recent shows         │
   │  Gila Monster   40%   last Aug 16, 2025      │
   │  Robot Stop     34%                           │
   │  Rattlesnake    31%                           │
   │  The River      24%                           │
   │                                               │
   │  KNOWN TENDENCIES                             │
   │  • Marathon shows ≈1 in 5 — usually announced│
   │  • Microtonal nights draw from K.G./L.W.     │
   │  • Long jams typically after song 3          │
   └─────────────────────────────────────────────┘
   ```

3. **Action card** (instead of the action bar):
   ```
   ┌─────────────────────────────────────────────┐
   │  We can't predict tonight's setlist.         │
   │                                               │
   │  [ Pre-show explorer playlist 🎵 ]           │
   │  [ Browse archive at kglw.net ↗ ]            │
   └─────────────────────────────────────────────┘
   ```

The empty-feeling design is deliberate — it tells the user honestly
what we know and what we don't. Compared to a misleading "10%
probabilities" list, the silence in the middle of the screen is the
point.

---

## 5. Loading & error states

| State | Mobile | Web |
|-------|--------|-----|
| First load (no cache) | `PredictionHero` skeleton + 8 row skeletons via existing `Skeleton` component | Same |
| Corpus stale, fetching | Hero shows; banner: "Refreshing setlist data…" with `Skeleton` shimmer overlay on rows | Same |
| Cold corpus (artist has no setlists) | `EmptyState` (existing) — "We're pulling [artist]'s recent setlists from setlist.fm. Check back in a few hours." | Same |
| Confidence < 0.25 (and not `improvised` style) | Confidence dial renders gray instead of gold; copy: "Not enough data for a confident pick — but here's what we have." | Same |
| Spotify not connected | Action bar shows "Connect Spotify to build a hype playlist" instead of the playlist CTA | Same |
| Offline | The cached prediction renders with a small `📡 offline` chip on the hero; hype-playlist CTA disabled | Same |

---

## 6. Mobile vs iPad vs web

### Phone (<900pt)
The screens above. One-column, stack vertically. Hero collapses on
scroll into a 56-pt sticky strip. `SegmentedControl` between
`Setlist · Predicted · Songs` is the navigation.

### iPad three-pane (≥900pt)
Per §12f of the algorithm plan, the predicted setlist lives in the
*right* pane (`SetlistLab`) when the middle pane shows a concert.
Layout:

```
┌── iPad — show detail (concert) ───────────────────────────────────┐
│ Shows list      │ Show detail              │ Setlist Lab         │
│ ▌ MAR 23 MSG    │ ┌─────────────────────┐  │ ┌──────────────────┐ │
│ ▌ MAR 14 BOS    │ │ The National        │  │ │ ▰▰▰▰▰  94%       │ │
│ ▌ FEB 28 PHL    │ │ MSG · Mar 22, 2025  │  │ │ MISS POSSESSIVE  │ │
│                 │ │ Photos…             │  │ │                  │ │
│                 │ │ Setlist · 18 songs  │  │ │  Predicted       │ │
│                 │ │  1. Bloodbuzz Ohio  │  │ │  Setlist diff    │ │
│                 │ │  2. Mr November     │  │ │  Spotify         │ │
│                 │ │  3. Fake Empire 🆕  │  │ │                  │ │
│                 │ │  …                  │  │ │  [predicted body │ │
│                 │ │                     │  │ │   from §3.3,     │ │
│                 │ └─────────────────────┘  │ │   compact rows]   │ │
└─────────────────┴───────────────────────────┴────────────────────┘
```

The right pane uses the *compact* variant of every component:
- 48-pt rows instead of 64-pt.
- Hero replaces the dial with a 32-pt confidence strip.
- Below the predicted setlist, a stacked `SetlistDiff` card and
  `SpotifyExportCard` give the iPad-only "lab" feel.

### Web
The mobile single-column layout up to ~1024px. Above 1024px, the
predicted view becomes two-column inside the show-detail page —
predicted-setlist on the left, `SetlistDiff` + `SpotifyExportCard`
+ `SongHistoryCard` stacked on the right.

Above 1440px, a third column emerges with the per-song detail
mini-view (clicking a song row populates it without navigation),
mirroring the iPad three-pane.

---

## 7. Interaction microcopy

The voice across surfaces:

| Surface | Microcopy |
|---------|-----------|
| Confidence ≥ 0.85 stable | "Tonight is locked in — same setlist they've played all tour." |
| Confidence 0.5–0.85 stable | "A confident pick — minor variation between shows." |
| Confidence < 0.5 stable | "Not enough data for a confident pick — but here's what we have." |
| Rotating | "Phish rarely repeats setlists. Here's what's overdue and what slot it tends to fill." |
| Theatrical | "Tonight's show is choreographed top to bottom — same setlist with one rotating slot." |
| Improvised | "[Artist] rarely repeats sets. Predicting song-by-song isn't useful here." |
| Cold | "We're pulling [artist]'s recent setlists. Check back in a few hours." |
| Multi-night run | "Night N of M at [venue] — songs already played are excluded from tonight's picks." |

The copy is editorial, lowercase-friendly, contraction-heavy. Same
register as the rest of Showbook (the digest emails, the empty
states, the Brain replies).

---

## 8. What this means for shipping

This UI spec doesn't introduce new tokens, new fonts, or new
infrastructure beyond the components in §2. The wins are:

- **One prediction algorithm + four display variants.** The
  algorithm produces a `PredictedSetlist | RotatingPredictedSetlist
  | TheatricalPredictedSetlist | ImprovisedPredictedSetlist` union;
  the screen mounts the matching variant via a single switch on
  `prediction.style`.
- **Reuse over invention.** `Sheet`, `SegmentedControl`, `Banner`,
  `EmptyState`, `Skeleton`, `Toast`, `HeroCard` (web), and the type
  ramp / spacing grid all carry their existing weight. The 14
  new components are mostly compositions of existing primitives —
  `PredictionSongRow` is a row + a probability bar + a chip rail.
- **Tate McRae's screen is the ship target.** It's the most-used
  case (most artists are stable-style), it's visually richest, and
  its design exercises every shared component. Phish + Beyoncé +
  King Gizzard fall out as variants once the stable layout is
  done.