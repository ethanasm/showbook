# Showbook Mobile (`apps/mobile`)

Expo SDK 55 + Expo Router app. Read the
[repo-root `CLAUDE.md`](../../CLAUDE.md) first for project-wide
conventions; this file covers what's specific to the mobile app.

## Status

The app is feature-complete against the design handoff. See
[`docs/specs/mobile-roadmap.md`](../../docs/specs/mobile-roadmap.md)
for the build plan and
[`docs/specs/planned-improvements.md`](../../docs/specs/planned-improvements.md)
for outstanding follow-ups (push notifications wiring + the smaller
remaining items called out in the post-M5 audit, which has otherwise
been fully addressed).

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
  - `cache/` — `expo-sqlite` cache + `useCachedQuery` + outbox +
    `warmup.ts` (offline pre-fetch walker) + `useForegroundWarmup`
  - `mutations/` — optimistic mutation runner + outbox replay
  - `media/` — chunked upload pipeline (presigned R2)
  - `setlist-intel/` — pure helpers for the Phase 10 4-tab show detail
    (badge resolver, preview player, style switcher, tab routing,
    Spotify deep-link)
  - `spotify-connection.ts` — mobile Spotify OAuth flow
  - `useFormState.ts`, `env.ts`
  - `feedback.ts`, `network.ts`, `theme.ts`, `responsive.ts`,
    `search.ts` (`useDebouncedValue` now lives in `@showbook/shared/hooks`)
- `e2e/flows/` — Maestro flow YAML (sign-in / add-show / sign-out)

## Auth bridge

Native Google OAuth via `expo-auth-session`. The Google ID token is
sent to the web app's `POST /api/auth/mobile-token` endpoint, which
returns a NextAuth-compatible JWT stored in `expo-secure-store`.
Every tRPC request attaches that JWT as `Authorization: Bearer`.

Google sign-in cannot be validated in Expo Go because Expo Go produces
an `exp://...` redirect URI that Google rejects for this native flow.
Use a development build locally (`pnpm mobile:ios`, then
`pnpm mobile:start` for JS-only reloads) or a signed native build.

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
| `EXPO_PUBLIC_API_URL` | - | tRPC target. Use `https://localhost:3001` for an iOS simulator pointed at the local web stack with the dev cert, or a LAN/tunnel URL for a physical device. |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS` | - | iOS sign-in |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID` | - | Android sign-in |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB` | - | Sign-in on every platform. `expo-auth-session/providers/google` uses the web client ID as the ID-token audience even on native iOS/Android, so this is required not just for web preview. |
| `EXPO_PUBLIC_E2E_MODE` | unset | Maestro Cloud only — bypasses Google OAuth and reads a pre-baked JWT from SecureStore. Production builds ship with this unset; the bypass is dead code there. |
| `EXPO_PUBLIC_FORCE_OFFLINE` | unset | Set to `1` to pin `NetworkProvider` offline at module eval (skips the NetInfo subscription entirely). Used by the Playwright web harness + Maestro flows that need to exercise offline UX without flipping airplane mode. Production builds leave this unset. Runtime tests can also flip it via `__setForceOfflineForTest`. |

## Commands

From the repo root:

```bash
pnpm mobile:start      # Metro bundler for development client
pnpm mobile:ios        # build + install iOS development client
pnpm mobile:android    # build + install Android development client
pnpm mobile:ios:go     # Expo Go only; Google sign-in will not work
pnpm mobile:android:go
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
[`docs/specs/mobile-testing-strategy.md`](../../docs/specs/mobile-testing-strategy.md)
for the rationale and the test plan. The gate is
enforced by `pnpm verify:coverage` (run on every PR by CI), which
merges per-package LCOV via `scripts/coverage-report.mjs`. Locally:

```bash
pnpm --filter mobile test:coverage   # writes coverage/mobile-unit.info
```

The gate is independent from web's 80% gate — a breach in either
scope fails CI, and the report identifies which scope fell short.

## Maestro E2E flows

Three flows live under `e2e/flows/` — sign-in, add-show, sign-out.
CI sets `EXPO_PUBLIC_E2E_MODE=1` plus the test-session env vars
directly in the workflow step env (matching the `e2e` profile in
`eas.json` for parity with local EAS builds):

- `EXPO_PUBLIC_E2E_MODE=1` flips `lib/auth.ts` into bypass mode.
- `EXPO_PUBLIC_E2E_TEST_TOKEN` is the Showbook JWT for the test user,
  minted ahead of time against the e2e backend (sourced from the
  `MAESTRO_E2E_TOKEN` repo secret in CI).
- `EXPO_PUBLIC_E2E_TEST_USER_JSON` is the JSON-serialised
  `SessionUser` the JWT identifies (from `MAESTRO_E2E_USER_JSON`).

**Re-minting the token.** The JWT carries an expiry (NextAuth default
30 days), and the tRPC bearer path rejects an expired / wrong-secret
token with `UNAUTHORIZED` — which surfaces as "Couldn't load shows —
UNAUTHORIZED" on the Shows screen and breaks every flow that loads
data (e.g. `show-card-row-0` never appears). The sign-in step still
"passes" because E2E mode loads the baked-in session locally without
validating it. When that happens, re-mint and update the two repo
secrets. On a host with the e2e `DATABASE_URL` + `AUTH_SECRET`:

```bash
AUTH_SECRET=... DATABASE_URL=postgresql://.../showbook_e2e \
  pnpm mint:e2e-token --email maestro-e2e@showbook.test
# prints MAESTRO_E2E_TOKEN=... and MAESTRO_E2E_USER_JSON=...
```

The helper (`scripts/mint-e2e-token.mjs`) signs the token exactly like
`apps/web/lib/mobile-token.ts` (`encodeMobileToken`: same secret +
`authjs.session-token` salt) and defaults to a 365-day lifetime so the
CI-only credential doesn't expire mid-PR. Paste both printed values
into Settings → Secrets and variables → Actions.

All three are inlined at build time, so `loadE2ETestSession` returns
the bundled session as soon as the user taps "Continue with Google"
— no in-app deeplink seeding step, no `runScript`/`openLink` dance in
the Maestro YAML. SecureStore (`e2e.test-token` / `e2e.test-user`)
is still checked as a fallback if a future change reintroduces a
debug deeplink handler.

The pure helpers `isE2EMode` and `loadE2ETestSession` are
unit-tested in `lib/__tests__/auth.test.ts` with explicit assertions
that (a) an unset `EXPO_PUBLIC_E2E_MODE` is treated as not-E2E so a
misconfigured deploy can't accidentally ship the bypass, and (b) the
bundled-env path takes priority over SecureStore so a stale device
keychain can't override the build-time token.

**Debugging a failed run.** On every PR run that fails, the workflow
pushes the cold-launch screenshot + the Maestro per-flow screenshots
to the existing `pr-screenshots` orphan branch under
`mobile-e2e/run-<id>/`, then posts a PR comment with the raw
`raw.githubusercontent.com` URLs and an inlined text-node dump of the
cold-launch UI hierarchy. Reviewers (and Claude on the web) can
`WebFetch` those URLs directly — no need to download the GitHub
Actions artifact. The same files are also preserved as the
`maestro-debug-<run-id>` artifact for 7 days.

**Automated (Android only):** `.github/workflows/mobile-e2e.yml`
runs nightly + on push-to-`main` + on PRs labeled `mobile-visual`,
on a self-hosted runner inside the prod WSL box. Both the APK build
(local Gradle, no EAS round-trip) and the Maestro flows run on that
runner — no paid services. One-time runner setup:

```bash
# On the prod box:
bash scripts/setup-runner.sh           # GH Actions runner itself
bash scripts/setup-runner-android.sh   # Android SDK + AVD + Maestro
```

**Manual (iOS):** the dev Mac is the only Apple hardware in the loop
and isn't always on, so iOS e2e is a pre-push hygiene step rather
than CI gate. From the repo root with the iOS Simulator booted:

```bash
pnpm mobile:ios            # boot the simulator + start Metro
# in another terminal once the app is installed and signed in:
pnpm mobile:e2e:ios        # runs all 3 flows against the booted sim
pnpm mobile:e2e:dry        # no device — just YAML validation
```

`EXPO_PUBLIC_E2E_TEST_TOKEN` and `EXPO_PUBLIC_E2E_TEST_USER_JSON`
need to be exported in the shell before `pnpm mobile:ios` so they
get inlined into the development build; otherwise the bypass falls
through to an empty SecureStore and the sign-in tap surfaces
`invalid_response`.

See `docs/specs/mobile-testing-strategy.md` § Wave F for the
rationale on the Android-CI / iOS-manual split.

## Offline mode

The app is offline-first for the personal logbook. Three pieces:

- **Cache warm-up** (`lib/cache/warmup.ts`) — `warmCacheForOfflineUse`
  walks every read query for the user's shows, venues, performers (and
  the per-show setlist-intel data: `shows.detail`, `media.listForShow`,
  `setlistIntel.predictedSetlist`, plus past-only `songBadges` and
  `trackPreviewsForShow`) and writes each into the React Query cache.
  The persister attached by `CacheBridge` then writes them to SQLite for
  free. Triggers: post sign-in (in `TrpcProviders`), foreground if
  `lastWarmupAt > 6h` (`useForegroundWarmup`), and a "Sync now" button
  on the Me tab.
- **Outbox** (`lib/cache/outbox.ts`) — `PendingMutation` covers show
  CRUD + setlist + notes + venue / performer follow-unfollow + every
  `preferences.*` mutation + the two Spotify playlist exports
  (`spotify.createHypePlaylist` / `createHeardPlaylist`). The dispatcher
  in `OfflineBridge` swallows 404 / 409 on idempotent paths (follow /
  unfollow / removeRegion) so a queued change that's already in target
  state on the server doesn't stick forever.
- **Offline placeholders** — Search / Spotify integrations render
  `components/OfflineEmptyState.tsx` when `useNetwork().online` is
  false (no cached payload to fall back on for those routes).
  Everything else (Home / Shows / Venues / Artists / Show detail /
  Discover) reads from the persisted cache, so it renders offline
  once warm-up has run.

Search is **not** in the warm-up scope — query-shaped results update
only when online. Discover feeds joined the warm-up walker on
2026-05-19 so the daily-digest deep-link into `/discover` renders
meaningfully on a cold offline open. The map screen uses cached
`shows.listForMap` + the native map provider's tile cache.

## When changing the app

- Touching `lib/cache/`, `lib/mutations/`, or anything that talks to
  SQLite? Add a unit test under `lib/__tests__/` — that scope is
  inside the 80% coverage gate.
- Adding a new mutation? Add it to the `PendingMutation` union in
  `lib/cache/outbox.ts`, extend the `switch` in `OfflineBridge`
  (`app/_layout.tsx`), add a label to `MUTATION_LABEL` in
  `components/PendingWritesDrawer.tsx`, and wrap the call site in
  `runOptimisticMutation`. The exhaustive `_exhaustive: never` in the
  dispatcher catches missing cases at compile time.
- Adding a new read query the user should see offline? Extend
  `warmCacheForOfflineUse` in `lib/cache/warmup.ts` and write the
  result into the same React Query cache key the screen reads from
  (tRPC-native shape if the screen uses `trpc.X.useQuery`, mobile-
  prefixed if it uses `useCachedQuery`).
- Touching a screen under `app/`? Layout-heavy RN code is excluded
  from coverage, but you should still walk it in the simulator. If
  the screen calls a new tRPC procedure or mutation, the helper in
  `lib/` should pick up unit coverage.
- Adding a new write path? It needs an outbox entry so the
  optimistic mutation survives a kill / cold start. Don't reintroduce
  the per-screen fake-DB shims that the post-M5 audit flagged — use
  `getCacheDatabase()` and `createOutbox(db, { ensureMigrations: true })`.
- Changing auth? Mirror `lib/__tests__/auth.test.ts` so the
  E2E-bypass guard stays watertight.

## Headless web verification (Claude on the web)

The sandbox doesn't have iOS Simulator or a usable Android emulator, so
the inner-loop verification target is the Expo **web** bundle driven by
Playwright. Native-only modules are swapped at Metro resolve time via
`apps/mobile/web-shims/` (see `web-shims/README.md`) — they exist
**only** for the web bundle and never ship to iOS/Android.

```bash
pnpm mobile:web:build          # expo export --platform web (writes dist-web/)
pnpm mobile:web:test           # playwright test --config=playwright.config.ts
pnpm mobile:web:verify         # build + test
```

The Playwright config (`apps/mobile/playwright.config.ts`) launches a
dependency-free static server (`web-tests/serve.mjs`) against
`dist-web/`, then drives the bundle in a 390×844 Chromium viewport.
The smoke spec (`web-tests/smoke.spec.ts`) covers:
- App boots to the sign-in screen with no `pageerror` events.
- A pre-seeded session (written to `localStorage` via the
  `expo-secure-store` shim) routes past the auth gate into the tab
  shell.

When adding a new test, seed sessions via `page.addInitScript` writing
to `localStorage` keys prefixed with `secureStore::` — that namespace
is what `web-shims/expo-secure-store.js` reads from. The seed format
mirrors the Maestro flow: `showbook.auth.token`,
`showbook.auth.user` (JSON), and `showbook.auth.firstRunComplete`.

**What this loop is good for:** layout, navigation, signed-in/out
state, screen renders without throwing, tRPC hook wiring, optimistic
mutation visuals on the UI side. **What it isn't:** anything backed by
expo-sqlite (cache layer behaves as if empty), native maps,
camera/photo/library/location/notifications (all no-op'd), or the
Google OAuth round-trip (the `EXPO_PUBLIC_E2E_MODE=1` bypass is baked
into the web build).

The web loop is below the existing Maestro gate, not a replacement:
real e2e still runs on the Android emulator via
`.github/workflows/mobile-e2e.yml` whenever the PR carries the
`mobile-visual` label, and iOS coverage is still the manual
`pnpm mobile:e2e:ios` step on the dev Mac. Use the web loop to iterate
fast; let Maestro be the gate.

## Known limitations

- **Push notifications are not yet delivered.** The toggle in
  Preferences and the client-side permission prompt exist; the
  server side (Expo push token persistence + digest emission +
  deep-link routing) is the open follow-up tracked in
  `docs/specs/planned-improvements.md`.
