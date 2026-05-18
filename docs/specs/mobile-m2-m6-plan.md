# Showbook Mobile — M2–M6 Parallel Execution Plan

> Status: **Plan for M1 follow-on milestones.** M1 (Foundation) shipped via PR #8 + PR #23. This document plans M2–M6 with explicit dependency arrows so multiple branches can run in parallel.

---

## Context

M1 delivered the auth + theme + tab shell + first-run on top of Expo SDK 55, Expo Router, RN StyleSheet + `useTheme`, native Google OAuth bridged to NextAuth via `/api/auth/mobile-token`, expo-secure-store, and a bearer-auth tRPC client. The `(tabs)` shell exists; Home / Shows / Add / Map are empty placeholders. Me is fully wired.

What's left: 36 more design-handoff screens organized into M2–M6. The handoff bundle is at `/tmp/showbook-mobile/design_handoff_showbook_mobile/` (re-extract from `~/Downloads/showbook.zip` if missing).

---

## Cross-milestone dependency graph

```
M1 (done)
  ↓
M2 — Read flows (the gating dependency for everything else)
  │
  ├── M3 — Add + Edit         [parallel, needs M2 nav + ShowDetail to write into]
  ├── M4 — Media              [parallel, needs M2 ShowDetail to attach media to]
  ├── M5 — Discovery + secondaries  [parallel, mostly independent screens that link to M2 lists]
  │
  └── M6 — System polish + iPad  [partial parallel; some pieces don't even need M2]
```

**Key insight:** once M2 lands, **M3, M4, M5 can run in three concurrent branches**. M6 has independent pieces (toast/banner system, error boundaries) that can run *now* in parallel with M2 itself.

---

## Shared infrastructure to build once, reuse everywhere

These deserve their own small PRs **before or alongside M2** so every later milestone consumes the same primitives instead of reinventing:

| Piece | Goes into | Used by |
|---|---|---|
| `SegmentedControl` component | `apps/mobile/components/` | M2 Shows segments, M3 Add chat/form, M5 Discover filters, Me tab |
| `Toast` + `Banner` system + provider | `apps/mobile/components/` + `lib/feedback.ts` | M2 sync-failure banners, M3 save errors, M4 upload errors, M6 offline banner |
| `PullToRefresh` wrapper | `apps/mobile/components/` | M2 Home/Shows/Map, M5 Discover/Artists/Venues |
| Skeleton variants (`ShowCardSkeleton`, `MediaTileSkeleton`, `RowSkeleton`) | `apps/mobile/components/` | M2 Home/Shows, M4 media grid, M5 list screens |
| `ErrorBoundary` per route group | `apps/mobile/components/` | All routes |
| `useDebouncedValue` mobile port | `apps/mobile/lib/` (port from `apps/web/lib/`) | M3 venue typeahead, M5 Search |
| `expo-sqlite` cache layer + `useCachedQuery` wrapper | `apps/mobile/lib/cache/` | M2 Shows list, then everything later |

**Recommended:** spin up one small "shared kit" PR (call it M1.5) containing SegmentedControl + Toast/Banner + PullToRefresh + Skeleton variants + ErrorBoundary. Two days of work, unblocks everything else.

---

## M2 — Read flows (~10 screens, gating)

**Goal:** A signed-in user can browse their own shows on phone.

### Internal task graph

```
M2.A  expo-sqlite cache layer + useCachedQuery
        ↓ (gates real data on every M2 screen)

M2.B  Home screen          ┐
M2.C  Shows tab — Timeline ┤  parallel after M2.A
M2.D  Shows tab — Month    ┤
M2.E  Shows tab — Stats    ┤
M2.F  ShowDetail screen    ┤
M2.G  Map screen           ┘

M2.H  Me tab v2 (real activity feed, integrations rows)  [independent — parallel with anything]
M2.I  Skeletons + pull-to-refresh wiring on each list   [merged into B/C/D/G as touched]
```

### Dependencies inside M2

- M2.A blocks B/C/D/E/F/G (they read from the cache)
- M2.B/C/D/E/F/G all reuse `ShowCard`, `KindBadge`, `StateChip` from M1 — no extra blocking
- M2.D (Month) depends on M2.C's data shape but not its rendering
- M2.E (Stats) is a pure read of aggregate tRPC procedure — independent of timeline rendering
- M2.F (ShowDetail) depends on `(tabs)` nav from M1 and a Stack route
- M2.G (Map) needs `react-native-maps` or `@rnmapbox/maps` install + native config (one-time setup)

### Parallelism within M2

After M2.A ships:
- 4 concurrent agents on M2.B + M2.C + M2.F + M2.G (Home, Timeline, ShowDetail, Map)
- M2.D + M2.E follow after M2.C lands (data shape locks)
- M2.H runs in parallel from day 1

### tRPC procedures M2 consumes (all already exist in `@showbook/api`)

`shows.list`, `shows.byId`, `shows.byMonth`, `shows.stats`, `venues.byId`, `venues.list`. No backend changes needed for M2.

---

## M3 — Add + Edit (~6 screens)

**Goal:** Mobile becomes a write client.

### Internal task graph

```
M3.A  Venue typeahead component (debounced)  [pure UI; can start before M2]
M3.B  Add chat screen + LLM round-trip via existing /api/add/chat
M3.C  Add form fallback (uses M3.A)
M3.D  Edit show screen (uses M3.A)
M3.E  Show action sheet (Sheet from M1; bottom sheet over ShowDetail)
M3.F  Setlist composer

A → C, A → D
B, C, D, E, F can all run in parallel after A.
```

### Parallelism

5 concurrent agents on B/C/D/E/F after M3.A. M3.A is half a day.

### Backend — none new

`shows.create`, `shows.update`, `shows.delete`, `venues.search`, `setlists.upsert` already exist.

---

## M4 — Media (~6 screens)

**Goal:** Photo/video log of shows.

### Internal task graph

```
M4.A  Upload pipeline:
        - expo-image-picker + multi-select
        - chunked upload to existing /api/media/upload (presigned S3 URL)
        - per-file progress UI
        - retry/cancel
M4.B  MediaTile + media grid component (reused on ShowDetail)
M4.C  Lightbox screen (modal swipe nav)
M4.D  Tag performers sheet (consumes show.cast, posts media-tag mutations)
M4.E  Over-quota state screen + banner

A → B (grid renders results from upload)
A → C (lightbox plays uploaded media)
A → D (tag operates on uploaded media)
A → E (quota check is server-side; UI is independent if mocked)

B, C, D, E run in parallel after A.
```

### Parallelism

4 concurrent agents on B/C/D/E after M4.A.

### Backend changes required

- `/api/media/upload` (presigned URLs) — exists per `@showbook/api` `media` router
- Quota check endpoint — verify it returns the fields M4.E needs; small backend touch

---

## M5 — Discovery + secondaries (~5 screens)

**Goal:** Explore beyond your own log.

### Internal task graph

```
M5.A  Discover feed screen (consumes existing discover router)
M5.B  Artists list screen
M5.C  Artist detail screen (depends on M2.F ShowDetail patterns; also needs M4.B media grid for "tagged photos & videos")
M5.D  Venues list screen
M5.E  Venue detail screen (similar to M5.C)
M5.F  Search screen + omnisearch

All five (A/B/C/D/E/F) can run in parallel — they share zero state and reuse existing tRPC routers (discover, performers, venues, search).
```

C and E are richest if M4 lands first (they show tagged media). If M4 hasn't landed, render the media slot with `EmptyState` and unblock; backfill the grid in a small follow-up after M4.

### Parallelism

6 concurrent agents from day 1 of M5.

---

## M6 — System polish + iPad (~3 screens + cross-cutting)

**Goal:** Hardening + iPad.

### Internal task graph

```
M6.A  Offline detection + full-screen "can't connect" state
        + pending-writes queue UI (drawn from sqlite outbox table)
        [needs M2.A cache + M3 write flows to actually queue something — depends on M2 + M3]

M6.B  Toast / banner system  [pulled forward into shared kit M1.5; here we wire it up to real failure events]
        [no dependencies; can run from day 1]

M6.C  iPad three-pane landscape layout (Shows timeline + ShowDetail + Map together)
        [depends on M2 fully shipping all three]

A: depends on M2 + M3
B: independent
C: depends on M2
```

### Parallelism

M6.B can run in parallel with M2 itself. M6.A runs after M3 ships. M6.C runs after M2 ships.

---

## Suggested execution waves (calendar view)

Each wave is "what could be running in parallel" — assumes one agent per task with the existing subagent-driven-development skill.

```
Wave A (start now, ~3 days):
  ├── Shared kit (SegmentedControl, Toast/Banner, PullToRefresh, Skeleton variants, ErrorBoundary, mobile useDebouncedValue)
  └── M6.B Toast/Banner real wiring  [independent; can ride in the kit]

Wave B (after Wave A, ~2 days):
  └── M2.A — expo-sqlite cache + useCachedQuery  [solo; gates everything M2]

Wave C (after Wave B, ~5 days):
  ├── M2.B  Home
  ├── M2.C  Shows Timeline
  ├── M2.F  ShowDetail
  ├── M2.G  Map (incl. react-native-maps native config)
  └── M2.H  Me v2  [parallel from start]
  → after M2.C lands: add M2.D Month + M2.E Stats

Wave D (after Wave C, ~5 days, all in parallel as 3+ branches):
  ├── Branch M3 (Add + Edit):
  │     M3.A typeahead → M3.B/C/D/E/F (5 agents)
  ├── Branch M4 (Media):
  │     M4.A upload pipeline → M4.B/C/D/E (4 agents)
  └── Branch M5 (Discovery + secondaries):
  │     M5.A/B/C/D/E/F (6 agents from day 1)

Wave E (after Wave D, ~3 days):
  ├── M6.A  Offline + pending-writes UI  [needs M3 to have queued anything]
  └── M6.C  iPad three-pane

Wave F:
  TestFlight prep — replace asset placeholders, load real Geist fonts,
  end-to-end QA on real iOS + Android, beta deploy
```

Net wall-clock: ~3 weeks if Wave D actually runs three branches in parallel; ~6 weeks sequentially.

---

## Critical infrastructure decisions to lock now

These choices ripple across every later milestone. Decide before opening Wave A.

| Decision | Recommendation | Why |
|---|---|---|
| Maps library | `react-native-maps` (Expo-managed, MapKit on iOS / Google on Android) | Easier than Mapbox in managed workflow. M5/M6 don't need vector tiles. |
| SQLite ORM/wrapper | `@op-engineering/op-sqlite` or stay on raw `expo-sqlite` | Raw `expo-sqlite` is fine for M2; no ORM needed since we shadow tRPC results. |
| Image cache | `expo-image` (already a dep) | Built-in disk cache; no extra deps. |
| Picker | `expo-image-picker` | Multi-select up to 12 per design; verify version supports it. |
| Upload | Presigned S3 from existing `/api/media/upload` | Backend already there. |
| LLM Add | Existing Groq endpoint; no new wiring | Backend ready. |
| Maps style | Custom dark style matching `bg` token (M2.G writes the JSON) | Spec'd in handoff. |
| Push notifications | Defer to M6+ | Spec lists M2/M6; not on the M1–M5 critical path. |

---

## Per-milestone deliverable count (verification heuristic)

Each milestone PR should include roughly:

| Milestone | Screens | New components | New lib files | Tests |
|---|---|---|---|---|
| M2 | 5 (Home, Shows×3, ShowDetail, Map) + Me v2 | 4 (PullToRefresh, ListSkeleton, etc., MapPin, MapClusterSheet) | cache + sync helpers | ~50 |
| M3 | 5 (Add chat, Add form, Edit, Action sheet, Setlist) | VenueTypeahead, SetlistRow | mutation helpers | ~40 |
| M4 | 5 (Upload, Grid, Lightbox, Tag, Over-quota) | MediaTile, Uploader, LightboxControls | upload pipeline | ~30 |
| M5 | 5 (Discover, Artists×2, Venues×2, Search) | ArtistCard, VenueCard | search index helper | ~30 |
| M6 | 3 (Offline, Banner system, iPad) | OfflineBanner, PendingWritesList | offline detector | ~20 |

If a milestone PR has dramatically more or fewer files than this, scope likely drifted.

---

## Critical files to reference per milestone

(All paths are read-only; agents should NOT modify files in other milestone scopes when working on theirs.)

### M2
- Design source: `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/{home,home-empty,shows-list,shows-month,shows-stats,show-detail,map,map-sheet,me-and-modals}.jsx`
- tRPC procedures: `packages/api/src/routers/shows.ts`, `venues.ts`
- Existing M1 components: `apps/mobile/components/{ShowCard,KindBadge,StateChip,EmptyState,Skeleton,TopBar,Sheet}.tsx`

### M3
- Design source: `screens/{add-chat,add-form,show-action-sheet,setlist-composer,skeletons-and-edit}.jsx`
- Backend: `packages/api/src/routers/shows.ts` (`create`, `update`)
- LLM: existing `/api/add/chat` route in apps/web

### M4
- Design source: `screens/{media-detail,media-tag,upload-progress,overquota}.jsx` + `30-media-lightbox.jpg` reference
- Backend: `packages/api/src/routers/media.ts`, `apps/web/lib/s3.ts`

### M5
- Design source: `screens/{discover,artists,venues,search}.jsx` + screenshots 19-23, 26-27
- Backend: `packages/api/src/routers/{discover,performers,venues,search}.ts`

### M6
- Design source: `screens/{system-states,offline,error-toast,ipad-shows}.jsx`
- iPad reference: `screens/ipad-shows.jsx`

---

## What this plan deliberately does not do

- It does **not** write the M2 implementation plan in detail — that's its own brainstorm → spec → plan cycle when M2 starts. This is a *coordination* plan.
- It does **not** lock UI details past what the design source already specifies.
- It does **not** add scope beyond the 41-screen design handoff.

When ready to start a milestone, open a fresh brainstorm focused on that milestone, write its detailed plan in a new file, and execute via subagent-driven-development.
