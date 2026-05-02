# Showbook Mobile (`apps/mobile`)

Expo SDK 55 + Expo Router app. Read the
[repo-root `CLAUDE.md`](../../CLAUDE.md) first for project-wide
conventions; this file covers what's specific to the mobile app.

## Status

The app is feature-complete against the design handoff. M1–M6 have
all shipped. See
[`showbook-specs/mobile-roadmap.md`](../../showbook-specs/mobile-roadmap.md)
for the milestone breakdown and
[`showbook-specs/reviews/mobile-review-2026-05-02.md`](../../showbook-specs/reviews/mobile-review-2026-05-02.md)
for the post-M5 audit + outstanding follow-ups (sign-out cache
cleanup, real outbox on edit/setlist, push notifications wiring).

## Layout

- `app/` — Expo Router routes. `(auth)` is sign-in + first-run
  permissions, `(tabs)` is the 5-tab shell (Home, Shows, Add, Map,
  Me). Stack routes for Show / Venue / Artist detail, Add chat +
  form, Edit, setlist composer, media (upload / lightbox / tag),
  search, discover, integrations, and the offline / over-quota
  full-screen states all live alongside the tab group.
- `components/` — RN components: cards (`ShowCard`, `VenueCard`,
  `ArtistCard`), chrome (`TopBar`, `Sheet`, `Banner`, `Toast`),
  shared kit (`SegmentedControl`, `PullToRefresh`, `Skeleton`,
  `EmptyState`, `ErrorBoundary`), media (`MediaTile`, `MediaGrid`,
  `Uploader`), and the iPad `ThreePaneLayout`.
- `lib/` — non-UI code:
  - `auth.ts` — Google ID token round-trip + token storage
  - `trpc.ts` — bearer-auth tRPC client targeting `@showbook/api`
  - `cache/` — `expo-sqlite` cache + `useCachedQuery` + outbox
  - `mutations/` — optimistic mutation runner + outbox replay
  - `media/` — chunked upload pipeline (presigned R2)
  - `feedback.ts`, `network.ts`, `theme.ts`, `responsive.ts`,
    `search.ts`, `useDebouncedValue.ts`
- `e2e/flows/` — Maestro flow YAML (sign-in / add-show / sign-out)

## Auth bridge

Native Google OAuth via `expo-auth-session`. The Google ID token is
sent to the web app's `POST /api/auth/mobile-token` endpoint, which
returns a NextAuth-compatible JWT stored in `expo-secure-store`.
Every tRPC request attaches that JWT as `Authorization: Bearer`.

The web side is documented in
[`../web/CLAUDE.md`](../web/CLAUDE.md). The web env must set
`GOOGLE_OAUTH_MOBILE_AUDIENCES` to the comma-separated list of iOS +
Android + (web preview) Google OAuth client IDs that are allowed to
mint a mobile token.

## Environment variables

Set locally via shell or `.env.local`. Mobile-side vars are prefixed
`EXPO_PUBLIC_` so Expo inlines them at build time.

| Var | Default | Required for |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://showbook.example.com` | tRPC target. Override to your LAN IP or `http://localhost:3001` for local dev against the web stack. |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS` | - | iOS sign-in |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID` | - | Android sign-in |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB` | - | Expo web preview sign-in |
| `EXPO_PUBLIC_E2E_MODE` | unset | Maestro Cloud only — bypasses Google OAuth and reads a pre-baked JWT from SecureStore. Production builds ship with this unset; the bypass is dead code there. |

## Commands

From the repo root:

```bash
pnpm mobile:start      # Metro bundler
pnpm mobile:ios        # open in iOS Simulator
pnpm mobile:android    # open in Android emulator
pnpm mobile:typecheck
pnpm mobile:lint
pnpm mobile:test
```

Or from `apps/mobile/`: `pnpm start` / `pnpm ios` / `pnpm android` /
`pnpm typecheck` / `pnpm lint` / `pnpm test`.

## Test coverage

The mobile app runs an 80% line / branch / function coverage gate
**scoped to `apps/mobile/lib/**` only**. Layout-heavy code under
`app/` and `components/` is intentionally excluded — see
[`showbook-specs/mobile-testing-strategy.md`](../../showbook-specs/mobile-testing-strategy.md)
for the rationale and the per-milestone test plan. The gate is
enforced by `pnpm verify:coverage` (run on every PR by CI), which
merges per-package LCOV via `scripts/coverage-report.mjs`. Locally:

```bash
pnpm --filter mobile test:coverage   # writes coverage/mobile-unit.info
```

The gate is independent from web's 80% gate — a breach in either
scope fails CI, and the report identifies which scope fell short.

## Maestro E2E flows

Three flows live under `e2e/flows/` — sign-in, add-show, sign-out.
They run on Maestro Cloud nightly + on every push to `main` via
`.github/workflows/mobile-e2e.yml` (NOT per-PR, by design — see
`showbook-specs/mobile-testing-strategy.md` § Wave F). The cloud run
uses the `e2e` EAS profile (see `eas.json`) which sets
`EXPO_PUBLIC_E2E_MODE=1`. With that flag on, `lib/auth.ts` skips the
Google OAuth round-trip and instead reads a pre-baked Showbook JWT
from SecureStore keys `e2e.test-token` + `e2e.test-user`. The pure
helpers `isE2EMode` and `loadE2ETestSession` are unit-tested in
`lib/__tests__/auth.test.ts`, including an explicit assertion that
an unset env var is treated as not-E2E so a misconfigured deploy
can't accidentally ship the bypass.

Validate flow YAML locally without a device:

```bash
npx maestro test --dry-run apps/mobile/e2e/flows/
```

## When changing the app

- Touching `lib/cache/`, `lib/mutations/`, or anything that talks to
  SQLite? Add a unit test under `lib/__tests__/` — that scope is
  inside the 80% coverage gate.
- Touching a screen under `app/`? Layout-heavy RN code is excluded
  from coverage, but you should still walk it in the simulator. If
  the screen calls a new tRPC procedure or mutation, the helper in
  `lib/` should pick up unit coverage.
- Adding a new write path? It needs an outbox entry so the
  optimistic mutation survives a kill / cold start (M3 + M6.A
  pattern). Don't repeat the per-screen fake-DB shims that the
  post-M5 review flagged — use `getCacheDatabase()` and
  `createOutbox(db, { ensureMigrations: true })`.
- Changing auth? Mirror `lib/__tests__/auth.test.ts` so the
  E2E-bypass guard stays watertight.

## Known limitations

- **Geist font is a no-op loader.** `lib/fonts.ts` resolves
  immediately and the system sans falls back. On iOS this looks
  very close to Geist; the real font wires up in a later polish
  pass.
- **Asset placeholders are 1x1 PNGs.** Splash, icon, and adaptive
  icon need real artwork before TestFlight / Play Store submission.
- **Push notifications are not yet delivered.** The toggle in
  Preferences and the client-side permission prompt exist; the
  server side (Expo push token persistence + digest emission +
  deep-link routing) is the open follow-up tracked in the root
  `Planned Improvements.md`.
