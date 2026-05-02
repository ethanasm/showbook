# Showbook Mobile — Cloud-Claude Prompts (M2 → M6)

Each section is a complete, self-contained prompt for a fresh Claude session running in an isolated sandbox. Copy the entire fenced block — no other context required.

Plan reference: [`mobile-m2-m6-plan.md`](./mobile-m2-m6-plan.md). Run order respects the dependency graph there.

| Wave | Prompt | Branch | Depends on |
|---|---|---|---|
| B | B-1: M2.A cache | `claude/m2-cache` | Wave A merged (already on main) |
| C | C-1: Home | `claude/m2-home` | B-1 |
| C | C-2: Shows tab | `claude/m2-shows-tab` | B-1 |
| C | C-3: ShowDetail | `claude/m2-show-detail` | B-1 |
| C | C-4: Map | `claude/m2-map` | B-1 |
| C | C-5: Me v2 | `claude/m2-me-v2` | (independent — can run in parallel with B-1) |
| D | D-1: M3 Add+Edit | `claude/m3-add-edit` | C-1, C-3 |
| D | D-2: M4 Media | `claude/m4-media` | C-3 |
| D | D-3: M5 Discovery | `claude/m5-discover` | C-1, C-3 |
| E | E-1: M6.A Offline | `claude/m6-offline` | D-1 |
| E | E-2: M6.C iPad | `claude/m6-ipad` | C-2, C-3, C-4 |

---

## Prompt B-1 — `claude/m2-cache`

````
You are implementing one branch of the Showbook mobile app build, running
in an isolated sandbox.

SETUP
- Repo: ethanasm/showbook (clone fresh from main)
- Working dir: the repo root
- Run `pnpm install` once
- Design handoff: extract the user-provided `showbook.zip` to
  `/tmp/showbook-mobile/`. Read screen designs from
  `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/*.jsx`
  and reference screenshots in `screenshots/`. If the zip isn't
  available, ask before guessing.

CONVENTIONS
- Mobile is at `apps/mobile/`. Re-use existing primitives from
  M1 + Wave A: `components/{ShowCard,KindBadge,StateChip,TopBar,Sheet,
  EmptyState,Skeleton,SegmentedControl,Toast,Banner,PullToRefresh,
  ErrorBoundary,skeletons}.tsx` and `lib/{theme,auth,trpc,env,fonts,
  feedback,useDebouncedValue}.ts`.
- Reach for `useTheme()` for tokens — never hardcode colors.
- Use `lucide-react-native` for icons.
- @showbook/api is a devDependency: `import type { AppRouter }`.
- @showbook/shared is a runtime dep: `import { Kind, KIND_COLORS }`.
- All log lines via `@showbook/observability` (no console.*).
- Never log raw email/PII or auth tokens.
- Tests use node:test pattern, see existing
  `apps/mobile/lib/__tests__/`.
- Verify before committing: `pnpm -F mobile typecheck && pnpm -F
  mobile lint && pnpm -F mobile test`.

BRANCH + PR
- Branch off latest main: `git checkout -b claude/m2-cache`
- One commit per coherent piece (don't squash everything into one).
- PR title: "M2.A: expo-sqlite cache + useCachedQuery"
- PR body: what shipped, what's deliberately deferred, screenshots
  if you can capture them, test results.
- Don't push to main directly. Open a PR.

OUT OF SCOPE GUARD
- Don't touch tasks belonging to a different milestone-letter.
- If a screen needs data that doesn't exist yet, render an
  EmptyState with "Coming in M<N>" and document it.
- Stop and ask if you find yourself rewriting M1/Wave A files.

YOUR TASK: M2.A — expo-sqlite cache + useCachedQuery wrapper.

This is the gating dependency for the rest of M2. After it ships,
six parallel agents can build screens against it.

DELIVERABLES
- Install `expo-sqlite` (latest Expo-pinned version)
- `apps/mobile/lib/cache/db.ts` — singleton SQLite connection,
  schema migration runner, version table
- `apps/mobile/lib/cache/schema.ts` — tables that mirror the tRPC
  read shapes we need in M2:
    * shows (id PK, kind, state, headliner, venue_id, datetime,
      city, notes, updated_at)
    * venues (id PK, name, city, region, country, lat, lng,
      capacity, photo_url, updated_at)
    * sync_meta (key PK, value, updated_at) — last-sync per resource
- `apps/mobile/lib/cache/repo.ts` — pure read helpers (no React)
    * `getShows(filter?)`, `getShowById(id)`, `getShowsByMonth(year,
      month)`, `getVenueById(id)`, `getStats()`
- `apps/mobile/lib/cache/sync.ts` — background sync helpers
    * `syncShows()` — fetch via tRPC since last sync, upsert into
      sqlite, update sync_meta
    * `syncVenues()` — same shape
    * Each accepts the tRPC client + a getToken fn so it's testable
- `apps/mobile/lib/cache/useCachedQuery.ts` — hook
    * Reads from sqlite synchronously on mount (renders instantly
      with whatever's cached)
    * Triggers a network sync in the background
    * Returns `{ data, isStale, isSyncing, error, refetch }`
    * `data` updates when sync completes
- Wire sync triggers in `app/_layout.tsx`:
    * On app foreground (AppState change), kick a sync
    * On sign-in success, do an initial sync
    * On sign-out, drop the sqlite database (`db.close();
      FileSystem.deleteAsync`)
- Tests in `lib/__tests__/cache/`:
    * Schema migration runs cleanly on fresh DB
    * Migration is idempotent (running twice is a no-op)
    * `repo.getShows` returns filtered+ordered results
    * `useCachedQuery` returns cached data immediately, then
      updated data after sync (use a fake tRPC client)

OUT OF SCOPE
- Real screens consuming this — those are Wave C
- Write-side cache (mutations + outbox) — that's M3/M6
- Conflict resolution — last-write-wins per row is fine for read-only

REFERENCES
- Existing tRPC: `packages/api/src/routers/{shows,venues}.ts` for
  the procedures and their return shapes
- Plan: `showbook-specs/mobile-m2-m6-plan.md` § M2

VERIFY: as conventions block.
````

---

## Prompt C-1 — `claude/m2-home`

````
You are implementing one branch of the Showbook mobile app build, running
in an isolated sandbox.

SETUP
- Repo: ethanasm/showbook (clone fresh from main, AFTER M2.A has merged)
- Working dir: the repo root
- Run `pnpm install` once
- Design handoff: extract the user-provided `showbook.zip` to
  `/tmp/showbook-mobile/`. Read screen designs from
  `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/*.jsx`
  and reference screenshots in `screenshots/`. If the zip isn't
  available, ask before guessing.

CONVENTIONS
- Mobile is at `apps/mobile/`. Re-use existing primitives from
  M1 + Wave A: `components/{ShowCard,KindBadge,StateChip,TopBar,Sheet,
  EmptyState,Skeleton,SegmentedControl,Toast,Banner,PullToRefresh,
  ErrorBoundary,skeletons}.tsx` and `lib/{theme,auth,trpc,env,fonts,
  feedback,useDebouncedValue,cache}.ts`.
- Reach for `useTheme()` for tokens — never hardcode colors.
- Use `lucide-react-native` for icons.
- @showbook/api is a devDependency: `import type { AppRouter }`.
- @showbook/shared is a runtime dep: `import { Kind, KIND_COLORS }`.
- All log lines via `@showbook/observability` (no console.*).
- Never log raw email/PII or auth tokens.
- Tests use node:test pattern, see existing
  `apps/mobile/lib/__tests__/`.
- Verify before committing: `pnpm -F mobile typecheck && pnpm -F
  mobile lint && pnpm -F mobile test`.

BRANCH + PR
- Branch off latest main: `git checkout -b claude/m2-home`
- One commit per coherent piece.
- PR title: "M2.B: Home screen"
- PR body: what shipped, what's deliberately deferred, screenshots
  if you can capture them, test results.
- Don't push to main directly. Open a PR.

OUT OF SCOPE GUARD
- Don't touch tasks belonging to a different milestone-letter.
- If a screen needs data that doesn't exist yet, render an
  EmptyState with "Coming in M<N>" and document it.
- Stop and ask if you find yourself rewriting M1/Wave A files.

YOUR TASK: M2.B — Home screen.

Replace `apps/mobile/app/(tabs)/index.tsx`'s placeholder with the real
Home screen.

DESIGN: `screens/home.jsx` (full version) and `screens/home-empty.jsx`
(empty state). Screenshots: 02 (empty), 03 (dark), 04 (light).

DELIVERABLES
- Real Home composed of:
    * "NOW PLAYING" section if a show is happening today (compact
      ShowCard, status pill, current setlist if any)
    * "UPCOMING" section (next 3 ticketed shows as ShowCards)
    * "RECENTLY ADDED" section (last 3 past shows)
    * "WISHLIST" section (top 3 watching shows)
    * Pull-to-refresh — use `useThemedRefreshControl` from
      `components/PullToRefresh.tsx`
    * Skeleton via `ShowCardListSkeleton` while first sync runs
    * Empty state per design when user has zero shows
- Reads via `useCachedQuery` from M2.A (do NOT call tRPC directly)
- Each ShowCard navigates to `/show/[id]` via expo-router's `Link`
  (M2.F creates that route; OK to link to a route that doesn't
  exist yet — Expo Router warns but doesn't crash)
- Section headers use the existing eyebrow caption style

OUT OF SCOPE
- ShowDetail — M2.F
- Add flow — M3
- Setlist editing on the now-playing card — M3

VERIFY: as conventions block.
````

---

## Prompt C-2 — `claude/m2-shows-tab`

````
You are implementing one branch of the Showbook mobile app build, running
in an isolated sandbox.

SETUP
- Repo: ethanasm/showbook (clone fresh from main, AFTER M2.A has merged)
- Working dir: the repo root
- Run `pnpm install` once
- Design handoff: extract the user-provided `showbook.zip` to
  `/tmp/showbook-mobile/`. Read screen designs from
  `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/*.jsx`
  and reference screenshots in `screenshots/`. If the zip isn't
  available, ask before guessing.

CONVENTIONS
- Mobile is at `apps/mobile/`. Re-use existing primitives from
  M1 + Wave A: `components/{ShowCard,KindBadge,StateChip,TopBar,Sheet,
  EmptyState,Skeleton,SegmentedControl,Toast,Banner,PullToRefresh,
  ErrorBoundary,skeletons}.tsx` and `lib/{theme,auth,trpc,env,fonts,
  feedback,useDebouncedValue,cache}.ts`.
- Reach for `useTheme()` for tokens — never hardcode colors.
- Use `lucide-react-native` for icons.
- @showbook/api is a devDependency: `import type { AppRouter }`.
- @showbook/shared is a runtime dep: `import { Kind, KIND_COLORS }`.
- All log lines via `@showbook/observability` (no console.*).
- Never log raw email/PII or auth tokens.
- Tests use node:test pattern.
- Verify before committing: `pnpm -F mobile typecheck && pnpm -F
  mobile lint && pnpm -F mobile test`.

BRANCH + PR
- Branch off latest main: `git checkout -b claude/m2-shows-tab`
- One commit per coherent piece (Timeline / Month / Stats can each
  be a separate commit).
- PR title: "M2.C+D+E: Shows tab — Timeline / Month / Stats"
- PR body: what shipped, screenshots, test results.
- Don't push to main directly. Open a PR.

OUT OF SCOPE GUARD
- Don't touch tasks belonging to a different milestone-letter.
- If a screen needs data that doesn't exist yet, render an
  EmptyState with "Coming in M<N>" and document it.

YOUR TASK: M2.C+D+E — Shows tab with three segments.

Replace `apps/mobile/app/(tabs)/shows.tsx`. Single screen with a
SegmentedControl at the top switching between three sub-views.

DESIGN: `screens/shows-list.jsx`, `screens/shows-month.jsx`,
`screens/shows-stats.jsx`. Screenshots: 06–09.

DELIVERABLES
- TopBar: "Shows", large variant
- SegmentedControl below TopBar: Timeline / Month / Stats
- **Timeline**: infinite-scroll FlatList of ShowCards, sticky month
  section headers, pull-to-refresh, skeleton during initial load
- **Month**: calendar grid (custom — don't pull a calendar lib).
  Pinned months at the top, swipe left/right between months
- **Stats**: total shows / distinct artists / distinct venues / top
  kind / top venue / miles traveled / longest streak — big `stat`
  type from the type ramp
- All three pull from `useCachedQuery` (M2.A)
- Stats has its own tRPC procedure `shows.stats` — call via
  cache wrapper; data fetches once and stays for the session

OUT OF SCOPE
- Filters — defer to M5 search
- Per-show drill-down on the calendar (just routes to ShowDetail)

VERIFY: as conventions block.
````

---

## Prompt C-3 — `claude/m2-show-detail`

````
You are implementing one branch of the Showbook mobile app build, running
in an isolated sandbox.

SETUP
- Repo: ethanasm/showbook (clone fresh from main, AFTER M2.A has merged)
- Working dir: the repo root
- Run `pnpm install` once
- Design handoff: extract the user-provided `showbook.zip` to
  `/tmp/showbook-mobile/`. Read screen designs from
  `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/*.jsx`
  and reference screenshots in `screenshots/`. If the zip isn't
  available, ask before guessing.

CONVENTIONS
- Mobile is at `apps/mobile/`. Re-use existing primitives from
  M1 + Wave A: `components/{ShowCard,KindBadge,StateChip,TopBar,Sheet,
  EmptyState,Skeleton,SegmentedControl,Toast,Banner,PullToRefresh,
  ErrorBoundary,skeletons}.tsx` and `lib/{theme,auth,trpc,env,fonts,
  feedback,useDebouncedValue,cache}.ts`.
- Reach for `useTheme()` for tokens — never hardcode colors.
- Use `lucide-react-native` for icons.
- @showbook/api is a devDependency: `import type { AppRouter }`.
- @showbook/shared is a runtime dep: `import { Kind, KIND_COLORS }`.
- All log lines via `@showbook/observability` (no console.*).
- Never log raw email/PII or auth tokens.
- Tests use node:test pattern.
- Verify before committing: `pnpm -F mobile typecheck && pnpm -F
  mobile lint && pnpm -F mobile test`.

BRANCH + PR
- Branch off latest main: `git checkout -b claude/m2-show-detail`
- PR title: "M2.F: Show detail screen"
- PR body: what shipped, screenshots, test results.

OUT OF SCOPE GUARD
- Don't touch other milestone-letter tasks.
- If a screen needs data not yet built, render an EmptyState with
  "Coming in M<N>".

YOUR TASK: M2.F — Show detail screen.

Add new route `apps/mobile/app/show/[id].tsx` (Stack route, not
inside (tabs)). The Home, Shows, and Map screens link into this.

DESIGN: `screens/show-detail.jsx`. Screenshots 10 (dark) + 11 (light).

DELIVERABLES
- TopBar with back button + show kind badge
- Hero: serif headliner (Georgia, type ramp `headliner`), date,
  venue + city, "in N days" / "N days ago" relative copy
- Status row: KindBadge + StateChip + Capacity / SoldOut chip
- Cover photo if set (use `expo-image`); skeleton while loading
- Action chips: "Edit show" / "Setlist" / "Notes" — each opens a
  Sheet or routes; stub to "Coming in M3" for M2
- Media grid placeholder ("Photos arrive in M4") — render
  `<EmptyState>` with the right copy
- Loaded via `useCachedQuery({ key: ['show', id] })` from M2.A;
  background re-sync on mount
- Map preview tile if venue has lat/lng (small static MapView snapshot
  — only if M2.G is already in main; otherwise omit)
- Long-press → `<Sheet>` with show actions (placeholder list)

OUT OF SCOPE
- Edit show, setlist composer, action sheet wiring — M3
- Media grid + lightbox — M4

VERIFY: as conventions block.
````

---

## Prompt C-4 — `claude/m2-map`

````
You are implementing one branch of the Showbook mobile app build, running
in an isolated sandbox.

SETUP
- Repo: ethanasm/showbook (clone fresh from main, AFTER M2.A has merged)
- Working dir: the repo root
- Run `pnpm install` once
- Design handoff: extract the user-provided `showbook.zip` to
  `/tmp/showbook-mobile/`. Read screen designs from
  `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/*.jsx`
  and reference screenshots in `screenshots/`. If the zip isn't
  available, ask before guessing.

CONVENTIONS
- Mobile is at `apps/mobile/`. Re-use existing primitives from
  M1 + Wave A: `components/{ShowCard,KindBadge,StateChip,TopBar,Sheet,
  EmptyState,Skeleton,SegmentedControl,Toast,Banner,PullToRefresh,
  ErrorBoundary,skeletons}.tsx` and `lib/{theme,auth,trpc,env,fonts,
  feedback,useDebouncedValue,cache}.ts`.
- Reach for `useTheme()` for tokens — never hardcode colors.
- Use `lucide-react-native` for icons.
- @showbook/api is a devDependency: `import type { AppRouter }`.
- @showbook/shared is a runtime dep.
- All log lines via `@showbook/observability` (no console.*).
- Never log raw email/PII or auth tokens.
- Tests use node:test pattern.
- Verify before committing: `pnpm -F mobile typecheck && pnpm -F
  mobile lint && pnpm -F mobile test`.

BRANCH + PR
- Branch off latest main: `git checkout -b claude/m2-map`
- PR title: "M2.G: Map screen with clustered pins"
- PR body: what shipped, screenshots, test results, **and the new
  Google Maps API key env var setup notes for the user.**

OUT OF SCOPE GUARD
- Don't touch other milestone-letter tasks.

YOUR TASK: M2.G — Map screen.

Replace `apps/mobile/app/(tabs)/map.tsx` with the real map.

DESIGN: `screens/map.jsx`, `screens/map-sheet.jsx`. Screenshots 17–18.

DELIVERABLES
- Install `react-native-maps` (Expo-managed flow). Add the iOS +
  Android plugin entries in `app.config.ts`. Document the Google
  Maps API key env var if Android needs it (`EXPO_PUBLIC_GOOGLE_
  MAPS_API_KEY`).
- Custom dark/light map style matching `bg` token — drop into
  `apps/mobile/app/(tabs)/map-style-{dark,light}.json`
- Cluster pins by show kind color (colored dots, no clustering lib —
  hand-roll: group nearby pins via grid bucketing)
- Tap pin → `<Sheet>` with venue name, city, last show date,
  "Open detail" → routes to ShowDetail of the most recent show
- "Search this area" pill appears after the user pans (track
  `region` change)
- Reads venues + shows via `useCachedQuery` (M2.A)
- Empty state: if user has zero shows with geo, show
  `<EmptyState>` with "Add a show with a venue and it'll pin here"

OUT OF SCOPE
- Real clustering — bucket-grouping is fine for M2
- Search — M5

VERIFY: as conventions block.
````

---

## Prompt C-5 — `claude/m2-me-v2`

````
You are implementing one branch of the Showbook mobile app build, running
in an isolated sandbox.

SETUP
- Repo: ethanasm/showbook (clone fresh from main; can run in parallel
  with M2.A — the Me tab doesn't need the cache layer for M2)
- Working dir: the repo root
- Run `pnpm install` once
- Design handoff: extract the user-provided `showbook.zip` to
  `/tmp/showbook-mobile/`. Read screen designs from
  `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/*.jsx`
  and reference screenshots in `screenshots/`. If the zip isn't
  available, ask before guessing.

CONVENTIONS
- Mobile is at `apps/mobile/`. Re-use existing primitives from
  M1 + Wave A: `components/{ShowCard,KindBadge,StateChip,TopBar,Sheet,
  EmptyState,Skeleton,SegmentedControl,Toast,Banner,PullToRefresh,
  ErrorBoundary,skeletons}.tsx` and `lib/{theme,auth,trpc,env,fonts,
  feedback,useDebouncedValue}.ts`.
- Reach for `useTheme()` for tokens — never hardcode colors.
- Use `lucide-react-native` for icons.
- @showbook/api is a devDependency: `import type { AppRouter }`.
- @showbook/shared is a runtime dep.
- All log lines via `@showbook/observability` (no console.*).
- Never log raw email/PII or auth tokens.
- Tests use node:test pattern.
- Verify before committing: `pnpm -F mobile typecheck && pnpm -F
  mobile lint && pnpm -F mobile test`.

BRANCH + PR
- Branch off latest main: `git checkout -b claude/m2-me-v2`
- PR title: "M2.H: Me tab v2 with integrations + activity"
- PR body: what shipped, deferred items, screenshots, test results.

OUT OF SCOPE GUARD
- Don't touch other milestone-letter tasks.
- If a tRPC procedure for activity feed doesn't exist yet, stub the
  section with EmptyState + a TODO and document the missing API.

YOUR TASK: M2.H — Me tab v2 (real activity, integrations).

Extend `apps/mobile/app/(tabs)/me.tsx` from its M1 stub to the full
design.

DESIGN: `screens/me-and-modals.jsx` PreferencesScreen.
Screenshots 24 (dark) + 25 (light).

DELIVERABLES (additions on top of M1's user/theme/sign-out)
- INTEGRATIONS section: Gmail (connected/disconnected status),
  Ticketmaster (linked status), Google Places (linked) — for M2 just
  read existing prefs router and render display values; tapping a row
  goes to a stub "manage integration" screen pushed from a Stack
  route (or just a Coming-in-M3 EmptyState)
- REGION section: Default region row (reads from prefs router)
- Activity feed below the integrations: 5 most recent activity items
  ("Added No Doubt at the Sphere", "Tagged 3 photos on Bleachers")
  — call new tRPC procedure if it exists, otherwise stub the section
  and document the missing API
- All section headers use the existing eyebrow caption style
- Density preference (Comfortable / Compact) — wire it through
  `useTheme().setDensity` (extend the hook minimally if needed)

OUT OF SCOPE
- Actually managing integrations — M3 (Gmail), later (others)
- Notifications / Export — defer

VERIFY: as conventions block.
````

---

## Prompt D-1 — `claude/m3-add-edit`

````
You are implementing one branch of the Showbook mobile app build, running
in an isolated sandbox.

SETUP
- Repo: ethanasm/showbook (clone fresh from main, AFTER M2.B + M2.F
  have merged)
- Working dir: the repo root
- Run `pnpm install` once
- Design handoff: extract the user-provided `showbook.zip` to
  `/tmp/showbook-mobile/`. Read screen designs from
  `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/*.jsx`
  and reference screenshots in `screenshots/`. If the zip isn't
  available, ask before guessing.

CONVENTIONS
- Mobile is at `apps/mobile/`. Re-use existing primitives from
  M1 + Wave A + M2: `components/{ShowCard,KindBadge,StateChip,TopBar,
  Sheet,EmptyState,Skeleton,SegmentedControl,Toast,Banner,
  PullToRefresh,ErrorBoundary,skeletons}.tsx` and `lib/{theme,auth,
  trpc,env,fonts,feedback,useDebouncedValue,cache}.ts`.
- Reach for `useTheme()` for tokens — never hardcode colors.
- Use `lucide-react-native` for icons.
- @showbook/api is a devDependency: `import type { AppRouter }`.
- @showbook/shared is a runtime dep.
- All log lines via `@showbook/observability` (no console.*).
- Never log raw email/PII or auth tokens.
- Tests use node:test pattern.
- Verify before committing: `pnpm -F mobile typecheck && pnpm -F
  mobile lint && pnpm -F mobile test`.

BRANCH + PR
- Branch off latest main: `git checkout -b claude/m3-add-edit`
- One commit per sub-feature (typeahead, add-chat, add-form, edit,
  action-sheet, setlist).
- PR title: "M3: Add + Edit + Setlist composer"
- PR body: per-sub-feature breakdown, screenshots, test results.

OUT OF SCOPE GUARD
- Don't touch other milestone-letter tasks.
- Media on the new show is M4 — stub it out with EmptyState.

YOUR TASK: M3 — full Add + Edit milestone (5 sub-screens).

Read `showbook-specs/mobile-m2-m6-plan.md § M3` for the sub-task graph.

DELIVERABLES (one PR, multiple commits)
- VenueTypeahead component (debounced via useDebouncedValue from
  Wave A) — reused in Add form + Edit form
- Add chat screen `app/(tabs)/add.tsx` — chat-first input. Posts to
  the existing `/api/add/chat` LLM endpoint. On parse: route to
  Add form prefilled with the structured payload.
- Add form `app/add/form.tsx` — full structured input: kind,
  headliner, venue (typeahead), date, time, state, support acts,
  notes, ticket fields. Submits via `shows.create` tRPC mutation.
- Edit show `app/show/[id]/edit.tsx` — same form prefilled, dirty
  state indicator, save via `shows.update`.
- Show action sheet — long-press on a ShowCard → Sheet with actions
  (Edit, Mark watched, Delete with confirm). Wire into ShowCard's
  onLongPress.
- Setlist composer `app/show/[id]/setlist.tsx` — manual track entry,
  drag-to-reorder via react-native-draggable-flatlist, encore divider,
  borrow-setlist suggestion when setlist.fm has a match. Posts to
  `setlists.upsert`.
- Optimistic UI: write to sqlite cache first, then mutate, then
  reconcile. Use a small outbox table (`pending_writes`) so failures
  are retryable.

DESIGN: `screens/{add-chat,add-form,show-action-sheet,setlist-composer,
skeletons-and-edit}.jsx`. Screenshots 14–16, 23, 36, 37.

OUT OF SCOPE
- Media on the new show — M4
- Real-time setlist sync from setlist.fm — M5

VERIFY: as conventions block.
````

---

## Prompt D-2 — `claude/m4-media`

````
You are implementing one branch of the Showbook mobile app build, running
in an isolated sandbox.

SETUP
- Repo: ethanasm/showbook (clone fresh from main, AFTER M2.F merged)
- Working dir: the repo root
- Run `pnpm install` once
- Design handoff: extract the user-provided `showbook.zip` to
  `/tmp/showbook-mobile/`. Read screen designs from
  `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/*.jsx`
  and reference screenshots in `screenshots/`. If the zip isn't
  available, ask before guessing.

CONVENTIONS
- Mobile is at `apps/mobile/`. Re-use existing primitives from
  M1 + Wave A + M2: `components/{ShowCard,KindBadge,StateChip,TopBar,
  Sheet,EmptyState,Skeleton,SegmentedControl,Toast,Banner,
  PullToRefresh,ErrorBoundary,skeletons}.tsx` and `lib/{theme,auth,
  trpc,env,fonts,feedback,useDebouncedValue,cache}.ts`.
- Reach for `useTheme()` for tokens — never hardcode colors.
- Use `lucide-react-native` for icons.
- @showbook/api is a devDependency: `import type { AppRouter }`.
- @showbook/shared is a runtime dep.
- All log lines via `@showbook/observability` (no console.*).
- Never log raw email/PII or auth tokens.
- Tests use node:test pattern.
- Verify before committing: `pnpm -F mobile typecheck && pnpm -F
  mobile lint && pnpm -F mobile test`.

BRANCH + PR
- Branch off latest main: `git checkout -b claude/m4-media`
- One commit per sub-feature (upload, grid, lightbox, tagging,
  over-quota).
- PR title: "M4: Media upload + grid + lightbox + tagging"
- PR body: per-sub-feature breakdown, screenshots, test results.

OUT OF SCOPE GUARD
- Don't touch other milestone-letter tasks.

YOUR TASK: M4 — Media milestone (5 sub-screens).

Read `showbook-specs/mobile-m2-m6-plan.md § M4`.

DELIVERABLES
- Upload pipeline `lib/media/upload.ts`:
    * expo-image-picker multi-select up to 12
    * Per-file presigned-URL fetch via existing `media.requestUpload`
      tRPC procedure
    * Chunked upload to S3 with progress callbacks
    * Retry with exponential backoff
- Upload sheet (Sheet from M1) `app/show/[id]/upload.tsx` — list of
  selected files, per-file progress bar, cancel button, "Add captions"
  inline
- MediaTile component (rounded-lg square, tag-count chip overlay)
- Media grid added to show detail's M2 placeholder
- Lightbox screen `app/media/[id].tsx` — modal stack with:
    * Swipeable horizontal pager (FlatList horizontal pagingEnabled)
    * Pinch-zoom via react-native-gesture-handler
    * Caption + tag-count overlay
    * "Tag performers" button → opens M4 TagSheet
- TagSheet `app/show/[id]/tag/[mediaId].tsx` — bottom sheet with
  cast checklist, +Add not-listed flow
- Over-quota state — full-screen takeover when upload fails with
  402; CTA "Manage storage" (stub link)

DESIGN: `screens/{media-detail,media-tag,upload-progress,overquota}.jsx`.
Screenshots 30–32.

OUT OF SCOPE
- Server-side quota enforcement — already exists, just consume it
- Video transcoding — server handles that

VERIFY: as conventions block.
````

---

## Prompt D-3 — `claude/m5-discover`

````
You are implementing one branch of the Showbook mobile app build, running
in an isolated sandbox.

SETUP
- Repo: ethanasm/showbook (clone fresh from main, AFTER M2.B + M2.F
  merged)
- Working dir: the repo root
- Run `pnpm install` once
- Design handoff: extract the user-provided `showbook.zip` to
  `/tmp/showbook-mobile/`. Read screen designs from
  `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/*.jsx`
  and reference screenshots in `screenshots/`. If the zip isn't
  available, ask before guessing.

CONVENTIONS
- Mobile is at `apps/mobile/`. Re-use existing primitives from
  M1 + Wave A + M2: `components/{ShowCard,KindBadge,StateChip,TopBar,
  Sheet,EmptyState,Skeleton,SegmentedControl,Toast,Banner,
  PullToRefresh,ErrorBoundary,skeletons}.tsx` and `lib/{theme,auth,
  trpc,env,fonts,feedback,useDebouncedValue,cache}.ts`.
- Reach for `useTheme()` for tokens — never hardcode colors.
- Use `lucide-react-native` for icons.
- @showbook/api is a devDependency: `import type { AppRouter }`.
- @showbook/shared is a runtime dep.
- All log lines via `@showbook/observability` (no console.*).
- Never log raw email/PII or auth tokens.
- Tests use node:test pattern.
- Verify before committing: `pnpm -F mobile typecheck && pnpm -F
  mobile lint && pnpm -F mobile test`.

BRANCH + PR
- Branch off latest main: `git checkout -b claude/m5-discover`
- One commit per screen (Discover / Artists list / Artist detail /
  Venues list / Venue detail / Search).
- PR title: "M5: Discover + Artists + Venues + Search"
- PR body: per-screen breakdown, screenshots, test results.

OUT OF SCOPE GUARD
- Don't touch other milestone-letter tasks.
- If M4's MediaGrid hasn't merged, render the media slot in
  Artist/Venue detail with EmptyState and a follow-up TODO.

YOUR TASK: M5 — Discovery + secondary lists (6 screens).

Read `showbook-specs/mobile-m2-m6-plan.md § M5`.

DELIVERABLES
- `app/(tabs)/discover.tsx` — Discover is a separate screen.
  Decide with the design source whether to (a) swap Map ↔ Discover
  in the tab bar, (b) add Discover as a 6th tab, or (c) make
  Discover a Stack route reachable from Home. Default to (c) for
  M5 to avoid disturbing the tab nav; document the choice.

  Renders the existing discover tRPC feed: artist rail, nearby
  venue rail, on-sale-soon, friends-watching (if friends scope
  ships).
- `app/artists/index.tsx` — Artists list (followed + tagged in
  user's shows)
- `app/artists/[id].tsx` — Artist detail: bio header, upcoming
  tour rail, "your shows" feed, tagged photos & videos grid
  (consumes M4 MediaGrid if available; else empty)
- `app/venues/index.tsx` — Venues list (followed + visited)
- `app/venues/[id].tsx` — Venue detail: hero photo, capacity,
  upcoming shows there, "your shows there" feed, media-from-your-
  shows grid
- `app/search.tsx` — Search-anything modal (omnisearch). Debounce
  250ms via useDebouncedValue. Results grouped by Shows / Artists
  / Venues / Discover. Empty state with recent searches + jump-to.

DESIGN: `screens/{discover,artists,venues,search}.jsx`. Screenshots
19–23, 26–27.

OUT OF SCOPE
- Friends-watching scope — defer until friends layer is built
- Tour data scraping — backend already handles it

VERIFY: as conventions block.
````

---

## Prompt E-1 — `claude/m6-offline`

````
You are implementing one branch of the Showbook mobile app build, running
in an isolated sandbox.

SETUP
- Repo: ethanasm/showbook (clone fresh from main, AFTER M3 merged)
- Working dir: the repo root
- Run `pnpm install` once
- Design handoff: extract the user-provided `showbook.zip` to
  `/tmp/showbook-mobile/`. Read screen designs from
  `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/*.jsx`
  and reference screenshots in `screenshots/`. If the zip isn't
  available, ask before guessing.

CONVENTIONS
- Mobile is at `apps/mobile/`. Re-use existing primitives from
  M1 + Wave A + M2 + M3: `components/{ShowCard,KindBadge,StateChip,
  TopBar,Sheet,EmptyState,Skeleton,SegmentedControl,Toast,Banner,
  PullToRefresh,ErrorBoundary,skeletons}.tsx` and `lib/{theme,auth,
  trpc,env,fonts,feedback,useDebouncedValue,cache}.ts`.
- Reach for `useTheme()` for tokens — never hardcode colors.
- Use `lucide-react-native` for icons.
- @showbook/api is a devDependency: `import type { AppRouter }`.
- @showbook/shared is a runtime dep.
- All log lines via `@showbook/observability` (no console.*).
- Never log raw email/PII or auth tokens.
- Tests use node:test pattern.
- Verify before committing: `pnpm -F mobile typecheck && pnpm -F
  mobile lint && pnpm -F mobile test`.

BRANCH + PR
- Branch off latest main: `git checkout -b claude/m6-offline`
- PR title: "M6.A: Offline state + pending writes queue"
- PR body: what shipped, screenshots, test results.

OUT OF SCOPE GUARD
- Don't touch other milestone-letter tasks.

YOUR TASK: M6.A — Offline state + pending-writes queue UI.

Builds on M2.A's sqlite cache and M3's pending_writes outbox.

DELIVERABLES
- NetworkProvider in `lib/network.ts` — wraps NetInfo, exposes
  `useNetwork()` hook returning { online, lastSeenOnline }
- Offline detection wired into root layout: when offline, push
  a Banner (existing component from Wave A) saying "You're offline.
  Changes will sync when you're back."
- Full-screen offline state for cold launches with no cache —
  EmptyState variant in `app/_offline.tsx` (rendered by an early
  guard in `app/index.tsx`)
- Pending-writes drawer accessible from Me tab → "N changes
  pending" row → opens Sheet listing each pending write with retry/
  discard buttons. Reads from M3's outbox table.
- On reconnect: auto-retry pending writes via the same mutate path
  M3 used; banner updates to "Syncing N changes…" then dismisses

DESIGN: `screens/{system-states,offline,error-toast}.jsx`. Screenshots
33–34.

OUT OF SCOPE
- Conflict resolution UI — last-write-wins per field is fine for M1
- Background-fetch on iOS while app is suspended

VERIFY: as conventions block.
````

---

## Prompt E-2 — `claude/m6-ipad`

````
You are implementing one branch of the Showbook mobile app build, running
in an isolated sandbox.

SETUP
- Repo: ethanasm/showbook (clone fresh from main, AFTER M2.C/F/G merged)
- Working dir: the repo root
- Run `pnpm install` once
- Design handoff: extract the user-provided `showbook.zip` to
  `/tmp/showbook-mobile/`. Read screen designs from
  `/tmp/showbook-mobile/design_handoff_showbook_mobile/screens/*.jsx`
  and reference screenshots in `screenshots/`. If the zip isn't
  available, ask before guessing.

CONVENTIONS
- Mobile is at `apps/mobile/`. Re-use existing primitives from
  M1 + Wave A + M2.
- Reach for `useTheme()` for tokens — never hardcode colors.
- Use `lucide-react-native` for icons.
- @showbook/api is a devDependency: `import type { AppRouter }`.
- @showbook/shared is a runtime dep.
- All log lines via `@showbook/observability` (no console.*).
- Tests use node:test pattern.
- Verify before committing: `pnpm -F mobile typecheck && pnpm -F
  mobile lint && pnpm -F mobile test`.

BRANCH + PR
- Branch off latest main: `git checkout -b claude/m6-ipad`
- PR title: "M6.C: iPad three-pane landscape"
- PR body: what shipped, screenshots, test results.

OUT OF SCOPE GUARD
- Don't touch other milestone-letter tasks.

YOUR TASK: M6.C — iPad three-pane landscape layout.

DELIVERABLES
- Detect iPad / large screen via `Dimensions` + `Platform.isPad`
- New file `app/(tabs)/_layout.tsx` already routes; add a parallel
  layout that renders 3 panes when width > 900pt:
    * Left: Shows timeline list
    * Middle: ShowDetail (selected from left)
    * Right: Map preview pinned to selected show's venue
- Phone behavior unchanged (each pane is a separate route)
- Drag-divider between panes (optional polish)

DESIGN: `screens/ipad-shows.jsx`. Screenshots 42–43.

OUT OF SCOPE
- Multi-window / Stage Manager
- iPad-specific features beyond the three-pane

VERIFY: as conventions block.
````
