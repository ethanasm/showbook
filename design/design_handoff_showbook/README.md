# Handoff: Showbook — Entertainment Tracker

## Overview

Showbook is a personal entertainment tracker for logging and remembering live shows — concerts, festivals, Theatre, and comedy — attended alone or with friends. The design covers the full app surface across **mobile (iOS, 390×844)** and **web (1440×900)**, organized into a consolidated four-tab information architecture:

1. **Home** — a slim dashboard: "Next up" + "Recent 5"
2. **Shows** — unified list · calendar · stats (one page, three modes)
3. **Map** — geographic view of attended venues
4. **Artists** — per-artist pages (concerts, comedy, Theatre)
5. **Add** — structured form + conversational chat, on both surfaces

A core product principle: **the user never manually types cast lists, setlists, or tour names.** All that metadata is auto-fetched from third-party sources (setlist.fm for concerts, Playbill for Theatre, etc.) — see `WIREFRAMES/data-plan` for the provenance map.

---

## About the Design Files

The files in this bundle are **design references created in HTML** — interactive prototypes showing the intended look, layout, and behavior. They are **not production code to copy directly.**

The task is to **recreate these designs in the target codebase's environment** using its established patterns, component library, and conventions. If no codebase exists yet, pick an appropriate framework (React + Vite + Tailwind is a reasonable default for the web surface; SwiftUI or React Native for mobile) and implement there.

The HTML uses inline Babel-transpiled JSX for quick iteration. Do not mirror that architecture in production — extract the visual spec, component structure, and interaction model, then rebuild cleanly.

---

## Fidelity

**High-fidelity** — `hifi-v2.html` and `hifi.html` are pixel-accurate mockups with final typography, spacing, palette, iconography, and component composition. Recreate these 1:1 in the codebase's UI primitives.

**Low-fidelity wireframes** — `index.html` (plus everything under `WIREFRAMES/views/`) shows structural/architectural intent for every screen. Use these to understand the full information architecture and page-by-page content model; use the hi-fi files for visual fidelity.

When a screen exists only in wireframe (no hi-fi version), treat the wireframe as the structural brief and apply the hi-fi design tokens (below) for visual styling.

---

## Design Tokens

All tokens are defined authoritatively in `HIFI/sb-tokens.jsx`. Summary:

### Palette

| Token | Light | Dark |
|---|---|---|
| `bg` | `#FAFAF8` | `#0C0C0C` |
| `surface` | `#FFFFFF` | `#141414` |
| `surface2` | `#F2F1EC` | `#1C1C1C` |
| `ink` (primary text) | `#0B0B0A` | `#F5F5F3` |
| `muted` | `rgba(11,11,10,.55)` | `rgba(245,245,243,.55)` |
| `faint` | `rgba(11,11,10,.32)` | `rgba(245,245,243,.32)` |
| `rule` | `rgba(11,11,10,.10)` | `rgba(245,245,243,.10)` |
| `ruleStrong` | `rgba(11,11,10,.22)` | `rgba(245,245,243,.22)` |

### Kind accents (one per content type)

| Kind | Light ink | Dark ink |
|---|---|---|
| Concert | `#FF5C2E` | `#FF7A4E` |
| Theatre | `#E6447A` | `#F27BA1` |
| Comedy | `#E0A91C` | `#F4C542` |
| Festival | `#2BB673` | `#3DDC97` |

Kind accents are used for small signal elements (type dots, kind tags, key counts). They are **not** used as backgrounds for large surfaces. Body UI stays monochrome.

### Typography

- **Sans:** `Geist` — all UI, numbers, body copy
- **Mono:** `Geist Mono` — labels, metadata, dates, counts, tiny all-caps
- Number style: `font-feature-settings: 'tnum'; font-variant-numeric: tabular-nums;` for all stat/date numerals
- All-caps labels use mono at 10–11px with `letter-spacing: 0.08em`

The wireframes reference `Inter`, `JetBrains Mono`, `Kalam`, `Caveat` — those are **wireframe-only**. Production should use Geist + Geist Mono as specified in the hi-fi.

### Shape & rhythm

- **Border radius:** sharp / zero radius for the editorial direction. Rounded only on pills (`999px`) and phone status-bar chrome. Keep surfaces square.
- **Rule weight:** 1px hairlines using `rule` / `ruleStrong`. No drop shadows on cards.
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 px.
- **Iconography:** 24×24 viewBox, 1.6px stroke, square line caps/joins. Full set in `HIFI/sb-tokens.jsx → window.Icon`.

---

## Information Architecture

**Sidebar / tab bar:** Home · Shows · Map · Artists · Add (floating FAB on mobile)

### 01 · Home (slim)
**Purpose:** fast glance — what's next, what just happened.
- **Next up** block — single next show card with countdown, venue, kind tag
- **Recent 5** block — last five attended shows as a dense stacked list
- Everything else (rhythm charts, most-seen venue/artist, map heatmap) has been moved to **Shows → Stats** mode.
- Mobile: single column; Web: centered 720px content column on 1440 frame.

### 02 · Shows (unified list · calendar · stats)
Replaces what used to be three separate pages (Archive, Upcoming, Stats). **Segmented control at the top** switches between:

- **List mode** — ledger of all shows. Grouped by month; left gutter year rail. Columns: date · kind dot · headliner · support · venue · city · seat · paid · rating. Sortable. Filterable by kind, year, city.
- **Calendar mode** — month grid with kind-colored dots per day. Clicking a day expands an inline detail panel. Past vs upcoming differentiated by opacity.
- **Stats mode** — stacked-bar shows/year by kind, most-attended venues (top 10), most-seen artists (top 10), day-of-week rhythm heatmap. All derived; no input.

### 03 · Map
Full-bleed map of all venues user has attended. Markers sized by visit count. Clicking a venue opens an inspector panel listing every show there (date · headliner · seat).

### 04 · Artist page
Per-artist detail. Three layout variants — one per kind:
- **Concert artist:** tour history, setlist excerpts, venues map, "times seen: N"
- **Comedy artist:** special history, material notes, tour run-list
- **Theatre production:** cast on the night attended (auto-fetched from Playbill), performance-number context

### 05 · Add a show
Four variants kept — all four ship:
- Mobile · Form (structured)
- Mobile · Chat (conversational, Claude-powered)
- Web · Form
- Web · Chat

Required inputs from the user: **date, venue, headliner, optional photo, rating (0–5), +1 names, free-text note.** Everything else (support acts, setlist, tour name, cast, runtime) is auto-fetched from external sources — see the data plan.

### 06 · Single show detail
Per-kind layouts — see `WIREFRAMES/views/show-detail.jsx`:
- **Concert:** setlist (setlist.fm), tour name, support acts, venue details, user's seat/rating/photo/notes
- **Comedy:** tour name, material crowdsourced from nearby dates, venue, user's row, notes
- **Theatre:** cast on the night (Playbill), performance number, seat, notes

---

## Interactions & Behavior

- **Segmented control** on Shows page is live — clicking switches mode without navigation. State reflected in URL query (`?mode=calendar`).
- **Sidebar collapse** on web: tap-to-collapse to icon rail; persist preference in localStorage.
- **Tab bar on mobile:** standard iOS bottom bar; floating circular Add FAB centered above it.
- **Kind tag hover:** subtle underline in the kind color; no fill change.
- **Card click:** full-row click target opens show detail (no dedicated arrow icon).
- **Add flow submit:** show a skeleton state while third-party sources fetch (setlist.fm, Playbill, Songkick). Allow user to save immediately — metadata fills in asynchronously.

---

## State Management

Minimum viable schema:

```ts
type Show = {
  id: string;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival';
  date: string;           // ISO
  headliner: string;      // user-entered
  venue: { id: string; name: string; city: string; lat: number; lng: number };
  seat?: string;          // user-entered free text
  paid?: number;          // user-entered
  rating?: 0|1|2|3|4|5;
  note?: string;
  plusOnes: string[];     // user-entered names
  photoUrl?: string;
  // Auto-fetched — write-once, nullable
  tour?: string;
  support?: string[];
  setlist?: Song[];
  cast?: CastMember[];
  performanceNumber?: number;
};
```

Auto-fetched fields arrive asynchronously after save. UI must handle the loading → fetched → failed-fallback state per field.

---

## Files Included

### Root HTML entry points

- `hifi-v2.html` — **primary hi-fi entry.** Consolidated four-tab IA. Start here.
- `hifi.html` — earlier hi-fi exploration with additional variants (history, show-detail, map, artist, stats, upcoming). Useful for per-screen reference.
- `index.html` — wireframe canvas covering all screens; start here for IA and structural intent.

### `HIFI/` — hi-fi React components (Babel JSX)

- `sb-tokens.jsx` — **authoritative design tokens** (palette, type, icons). Port this first.
- `shared-data.jsx` — sample data used across mockups.
- `v2-shell.jsx` — app shell (sidebar + content area).
- `v2-home.jsx` — slim home (mobile + web).
- `v2-shows.jsx` — unified Shows page (list / calendar / stats).
- `home-editorial.jsx`, `home-mono.jsx`, `home-mono-v2.jsx`, `home-stub.jsx`, `web-home.jsx` — earlier home explorations.
- `history-*.jsx`, `upcoming-*.jsx`, `stats-*.jsx` — deprecated in v2 (merged into Shows) but retained for per-mode reference.
- `show-detail-*.jsx` — per-kind detail layouts (mobile + web + data).
- `artist-*.jsx` — per-kind artist pages.
- `map-*.jsx` — map view (mobile + web + data + shared).
- `add-mobile.jsx`, `add-web.jsx`, `add-chat.jsx` — add-a-show flows.

### `WIREFRAMES/` — low-fi wireframes

- `views/*.jsx` — one file per screen (home, history, show-detail, upcoming, add-flow, stats, artist, map, data-plan).
- `wf-primitives.jsx` — wireframe primitive components.

### Scaffolding (do not port)

- `design-canvas.jsx`, `ios-frame.jsx`, `browser-window.jsx` — device-frame and canvas scaffolding for the HTML prototype only. Not needed in production.

---

## Screenshots

Rendered previews of every screen are in `screenshots/`. Use them as a quick visual reference alongside the HTML sources:

**v2 (primary)**
- `01-home-mobile.png`, `02-home-web.png` — slim Home
- `03-shows-list-web.png`, `04-shows-calendar-web.png`, `05-shows-stats-web.png` — Shows (web, 3 modes)
- `06-shows-list-mobile.png`, `07-shows-calendar-mobile.png`, `08-shows-stats-mobile.png` — Shows (mobile)
- `09-add-form-mobile.png`, `10-add-chat-mobile.png`, `11-add-form-web.png`, `12-add-chat-web.png` — Add-a-show (4)

**Reference (from hifi.html)**
- `13-history-mobile.png`, `14-history-web.png`
- `15-show-detail-mobile.png`, `16-show-detail-web.png`
- `17-map-mobile.png`, `18-map-web.png`
- `19-artist-mobile.png`, `20-artist-web.png`
- `21-stats-mobile.png`, `22-stats-web.png`
- `23-upcoming-mobile.png`, `24-upcoming-web.png`

All screenshots are framed in their intended device/browser chrome (iOS frame for mobile, chrome window for web) at their native canvas size.

## Implementation Order (suggested)

1. Port `sb-tokens.jsx` → your theme system (Tailwind config, CSS variables, or design-token JSON).
2. Port `window.Icon` → your icon component set.
3. Build the shell: sidebar (web) + tab bar (mobile).
4. Build `Shows — List` first; it exercises 80% of the visual vocabulary (dates, kind tags, venue rows, tabular numerals).
5. Home, Add-form, Show Detail (concert variant).
6. Calendar mode, Stats mode, Map, Artist page.
7. Add-chat (Claude integration) last — depends on the shell being stable.

---

## Open Questions for the Developer

- **Auth / multi-user:** not designed. Is this single-user local-first, or cloud-synced with accounts?
- **Third-party data sources:** setlist.fm has a public API; Playbill does not — scraping, partnership, or user-confirmed autocomplete?
- **Photos:** stored where (local, S3, Supabase)?
- **Mobile:** native (SwiftUI/React Native) or PWA? The mobile mocks are iOS-flavored but the layout works as a mobile-web experience.

Flag these back to the product owner before starting implementation.
