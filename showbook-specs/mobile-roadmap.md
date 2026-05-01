# Showbook Mobile — Build Roadmap (M1–M6)

The mobile app is being built in six milestones. Each milestone is its own
brainstorm → spec → implementation plan → branch → merge cycle, ending in
a working app.

The design source-of-truth is the user-provided handoff bundle (extracted
locally for development reference; not committed). It contains 41 screens
of high-fidelity mocks across the flows below.

| # | Milestone | What ships | ~Screens |
|---|-----------|-----------|----------|
| **M1** | **Foundation** | Expo project, design tokens, navigation skeleton, tRPC client, Google OAuth bridge, light/dark theme, sign-in, first-run permissions, base components (ShowCard / KindBadge / StateChip / TopBar / TabBar / Sheet / EmptyState / Skeleton). Empty tab screens. | ~5 |
| **M2** | **Read flows** | Home, Shows (timeline / month / stats), Show detail, Map (clustered + pin sheet), Me. Skeletons + pull-to-refresh. Adds expo-sqlite cache. | ~10 |
| **M3** | **Add + Edit** | Add chat (LLM parse), Add form fallback + venue typeahead, edit show with dirty state, show action sheet, setlist composer (manual entry + drag-reorder + encore divider). | ~6 |
| **M4** | **Media** | Upload sheet (camera roll multi-select, per-file progress), media grid + lightbox, tag-performers sheet, over-quota state. | ~6 |
| **M5** | **Discovery + secondaries** | Discover feed, Artists list + Artist detail (tagged photos), Venues list + Venue detail (media from your shows), Search. | ~5 |
| **M6** | **System polish + iPad** | Offline / can't-connect full-screen state with pending-writes queue, error toast/banner system, iPad three-pane landscape (timeline + detail + map). | ~3 |

## Status

| Milestone | Status |
|---|---|
| M1 | In progress |
| M2 | Not started |
| M3 | Not started |
| M4 | Not started |
| M5 | Not started |
| M6 | Not started |

Update this table when each milestone ships.

## Stack decisions (locked for M1, may extend in later milestones)

- Expo SDK 50+ with TypeScript strict
- Expo Router (file-based)
- React Native StyleSheet + a `useTheme` hook (no CSS-in-JS library)
- Native Google OAuth via Expo AuthSession + a custom
  `/api/auth/mobile-token` endpoint that mints a JWT compatible with the
  existing NextAuth JWT
- Token storage in `expo-secure-store`
- Bearer-auth tRPC client (`AppRouter` type from `@showbook/api`)
- TanStack Query in-memory cache (M1) — `expo-sqlite` adds in M2
- Icons via `lucide-react-native`
- Geist Sans loaded via `expo-font`; Georgia is iOS system + serif fallback elsewhere
- Backend URL via `EXPO_PUBLIC_API_URL` (defaults to the prod tunnel)

## Why this supersedes the old T31 / T32 tasks

`showbook-specs/TASKS.md` had two tasks for mobile:

- T31 — Expo scaffold (depends on T14, T30): tab bar, OAuth, tRPC client, Home / Shows / Add (form only)
- T32 — Offline caching (depends on T31): expo-sqlite, foreground sync, offline Add blocker

Those are too narrow for the full design handoff. T31 is absorbed into
**M1 + M2** (M1 covers the scaffold and auth, M2 covers the actual list
rendering). T32 is absorbed into **M2** (cache lands when there's data
to cache). Future milestones cover features T31 / T32 don't anticipate
(media, setlist composer, Discover, etc.).
