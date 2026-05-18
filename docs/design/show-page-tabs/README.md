# Showbook — Tabbed Show Page (handoff)

Hi-fi mockups for the redesigned show detail page. Replaces the current vertical-stack layout (Media → Lineup → Setlist → Actions) with a four-tab system that adapts to the show's lifecycle (upcoming vs. past) and folds in the new music-layer features (Spotify integration, setlist intelligence).

Open `Show Page Tabs.html` in a browser. No build step — pure CDN React + Babel-standalone. The mockups render on a pannable design canvas; scroll-wheel + drag to pan, ⌘/ctrl+scroll to zoom. Click any artboard label to open it fullscreen.

---

## What's in here

```
Show Page Tabs.html        # entry — design canvas with all artboards
hifi/
  sb-tokens.jsx            # window.SB design tokens + window.Icon SVG set
show-tabs/
  data.jsx                 # window.SHOW + window.PAST_SHOW payloads
  components.jsx           # Hero, TitleBlock, TabBar, ShowTabsBody, CrumbBar
                           # + per-tab content (OverviewTab, SetlistTab, MediaTab, NotesTab)
  music-layer.jsx          # VibeRadar, EnergyArc, HypePlaylistCard,
                           # FanLoyaltyRing, DiscoveredRail, SpotifyFollowRail, etc.
  full-web.jsx             # FullWebShell — 1440-wide desktop layout w/ right rail
  design-canvas.jsx        # canvas chrome (presentation-only — drop in real app)
  ios-frame.jsx            # iPhone bezel for the mobile-app artboards
```

Everything attaches to `window.*` so files share scope across `<script type="text/babel">` tags. There are no ESM imports.

---

## The tab system

Four tabs, always in this order:

| Tab          | Before show                                  | After show                                   |
|--------------|----------------------------------------------|----------------------------------------------|
| **Overview** | Stats · lineup · actions                     | Stats · lineup · "you went" badge            |
| **Setlist**  | Predicted (confidence % + Hype Playlist CTA) | Actual (setlist.fm + Save to Spotify)        |
| **Media**    | Empty / auto-pulled artist content           | Photo grid · ticket stub · live playlist     |
| **Notes**    | Pre-show prompts                             | Post-show recap prompts                      |

Tab labels never change — muscle memory survives the show. **What changes is the badge** on each tab: a count (e.g. `16/12` for actual/predicted setlist length) or a confidence % (`92%`). See `TabBar` in `components.jsx`.

The hero shrinks but never disappears. Tab bar is sticky. Stat row collapses 4-col → 2×2 below 480px.

---

## Viewports shipped

The canvas has six sections of artboards:

1. **Half-screen web** (760×900) — split-view friendly, sidebar collapsed to icons
2. **Mobile web** (390×844) — browser chrome + breadcrumb
3. **Mobile app** (393×852, iOS) — `UINavigationBar` instead of breadcrumb
4. **Full desktop · upcoming** (1440×900) — expanded sidebar + body + sticky right rail (radar, energy arc, hype playlist)
5. **Full desktop · past** (1440×900) — same shell, post-show state
6. **Past show · narrow viewports** — verifies the music-layer features collapse cleanly on mobile + half-screen
7. **Music-layer atoms** — each component isolated for reference

Plus an "intent" doc and a "what changed vs. current" callout sheet.

---

## Music-layer components

All in `show-tabs/music-layer.jsx`, all reading from `window.PAST_SHOW.musicLayer` (or `SHOW.musicLayer` for upcoming). Spec for each lives in `feature-plan-setlist-intelligence-music-layer.md` in the project root.

- **`<VibeRadar>`** — 7-axis polygon (energy, acoustic, happiness, danceability, instrumental, live, speech). Pre-show shows predicted vibe; post-show overlays actual on top.
- **`<EnergyArc>`** — sparkline of per-track energy across the setlist with the encore marked.
- **`<HypePlaylistCard>`** — pre-show CTA: "Generate a hype playlist from the predicted setlist." Pulls track count + minutes.
- **`<FanLoyaltyRing>`** — "you played 11/16 of their tracks" — donut + count.
- **`<DiscoveredRail>`** — "tracks you discovered live" — horizontal scroll with `+` to save to Spotify.
- **`<SpotifyFollowRail>`** — "fans of this artist also follow" — band tiles.
- **Pre-show priming italic** — "You played 6 No Doubt tracks in the 4 hours before the show." Inline copy in Overview.
- **30-sec preview button** — every track row in the setlist gets one.

---

## Implementation notes for the real app

**Data shape.** `data.jsx` has the full payload for both an upcoming and past show. Field names mirror what the spec docs assume — `kindKey`, `tour`, `lineup[]`, `setlist.predicted/actual`, `musicLayer.{vibePredicted, vibeActual, energyActual, encoreStart, discovered, ...}`.

**Tokens.** `window.SB` carries the dark/light palette + per-kind accents (`SB.kinds.concert.inkDark` is the stage blue used here). All colors in components reference tokens — no hardcoded hex except in placeholder graphics.

**Responsive strategy.** The mockup uses a `compact` prop on each component (passed by the viewport shell) instead of media queries, because each artboard has a fixed canvas size. In the real app, swap `compact` for media queries — the breakpoints are noted in `components.jsx` (~480px for stat row, ~768px for sidebar, ~1200px for the right rail).

**The hero placeholder is SVG.** `ShowHero` draws four silhouetted busts mimicking the No Doubt press shot. Replace with the real `cover_image_url` from the show payload — keep the 240px / 160px sizing curve.

**Icons.** `window.Icon` is a stroke-only SVG set, 1.5px stroke, 24×24 viewBox. The HTML polyfills `ChevronLeft`, `Edit`, `Trash`, `Camera` inline at the top of the entry script — fold those into the real icon set.

**Sidebar.** Each viewport's shell builds its own sidebar inline rather than sharing a `<Sidebar>` component (intentional — the half-screen icon-only and full-size expanded variants diverge enough that one component would be a mess of branching). Consolidate however your shell system prefers.

**Right rail (`full-web.jsx`).** Sticky on desktop, hidden below ~1200px. Past-show shows VibeRadar + EnergyArc + FanLoyalty; upcoming shows VibeRadar (predicted) + HypePlaylistCard.

**`design-canvas.jsx` and `ios-frame.jsx` are presentation chrome.** Drop them in the real app — they only exist to host the mockups.

---

## What's deliberately not modeled

- Real interactions: tabs are stateful per-artboard but persistence/routing is out of scope (real app: route param `?tab=setlist`).
- Loading / error / offline states — covered separately in `Setlist Intelligence.html` if you need them.
- Auth wall for Spotify — the "Save to Spotify" / "Connect Spotify" affordance is shown but not wired.
- Animations — tab change should crossfade content (~120ms), but the mockup snaps.
