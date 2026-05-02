# Showbook Mobile

Expo + TypeScript app for Showbook. See
[`showbook-specs/mobile-roadmap.md`](../../showbook-specs/mobile-roadmap.md)
for the M1-M6 milestone plan.

## Setup

Prerequisites:
- Node >= 20
- pnpm >= 9
- Xcode (for iOS Simulator) or Android Studio (for emulator)

From the repo root:

```bash
pnpm install
```

Then from this directory:

```bash
pnpm start         # start Metro bundler
pnpm ios           # build + open in iOS Simulator
pnpm android       # build + open in Android emulator
pnpm typecheck
pnpm lint
pnpm test
```

Or use the repo-root shortcuts (`pnpm mobile:start`, `pnpm mobile:ios`,
`pnpm mobile:typecheck`, etc.) — they forward to this package.

## Test coverage

The mobile app runs an 80% line / branch / function coverage gate
scoped to **`apps/mobile/lib/**` only**. Layout-heavy code under
`app/` and `components/` is intentionally excluded — see
[`showbook-specs/mobile-testing-strategy.md`](../../showbook-specs/mobile-testing-strategy.md)
for the rationale and the per-milestone test plan. The gate is
enforced by `pnpm verify:coverage` (run on every PR by CI), which
merges per-package LCOV via `scripts/coverage-report.mjs`. Locally:

```bash
pnpm test:coverage   # writes coverage/mobile-unit.info
```

The gate is independent from web's 80% gate — a breach in either
scope fails CI, and the report identifies which scope fell short.

## Environment variables

Set these locally via shell or `.env.local`. Mobile-side vars are
prefixed `EXPO_PUBLIC_` so Expo inlines them at build time.

| Var | Default | Required for |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://showbook.example.com` | tRPC client target. Override to your LAN IP or `http://localhost:3001` for local dev against the web stack. |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS` | - | Sign in with Google on iOS (M1) |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID` | - | Sign in with Google on Android (M1) |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB` | - | Sign in with Google on Expo web preview (M1) |

The backend (`apps/web`) needs `GOOGLE_OAUTH_MOBILE_AUDIENCES` set
to the comma-separated list of these client IDs so it accepts the
mobile-issued ID tokens at `POST /api/auth/mobile-token`.

## What's in M1

The Foundation milestone ships the bones of the app:

- **Sign in with Google** — native OAuth via Expo AuthSession; ID
  token traded for a NextAuth-compatible JWT and stored in
  `expo-secure-store`.
- **First-run permissions** — welcome → notifications → photos →
  location → gmail (placeholder) flow, each with deferable asks.
- **5-tab nav** — Home, Shows, Add, Map, Me. Home / Shows / Add / Map
  are placeholder screens that route to the correct slot in the tab
  bar; real implementations land in M2 / M3.
- **Me tab** — real account info, theme toggle (System / Light /
  Dark) persisted to secure store, sign-out.
- **Theme system** — token-driven `ThemeProvider` + `useTheme` hook
  with light + dark palettes. No CSS-in-JS dependency.
- **Bearer-auth tRPC client** — talks to `@showbook/api` with the
  stored JWT; ready for real procedures in M2.

## Known limitations / M1 gotchas

- **Geist font is a no-op loader.** `lib/fonts.ts` resolves
  immediately and the system sans falls back. On iOS this looks very
  close to Geist; we'll wire the real font in a later polish pass.
- **Asset placeholders are 1x1 PNGs.** Splash, icon, and adaptive
  icon need real artwork before TestFlight / Play Store submission.
- **Real list data needs M2.** The Home / Shows / Add / Map tabs are
  intentionally empty — they show a "coming soon" affordance and
  exist so the tab bar layout is final.
- **Gmail OAuth scope ask is deferred to M3.** The first-run gmail
  step is a placeholder explainer screen; the actual scope grant
  happens during the Add flow in M3.
- **No offline cache yet.** TanStack Query keeps an in-memory cache;
  `expo-sqlite` is added in M2 alongside real data.

## Status

M1 (Foundation) is complete and ready to ship; M2 (Read flows) is
next. See `showbook-specs/mobile-roadmap.md` for the full roadmap.

## Maestro E2E flows (Wave F)

Three flows live under `e2e/flows/` — sign-in, add-show, sign-out.
They run on Maestro Cloud nightly + on every push to `main` via
`.github/workflows/mobile-e2e.yml` (NOT per-PR, by design — see
`showbook-specs/mobile-testing-strategy.md` § Wave F). The cloud run
uses the `e2e` EAS profile (see `eas.json`) which sets
`EXPO_PUBLIC_E2E_MODE=1`. With that flag on, `lib/auth.ts` skips the
Google OAuth round-trip and instead reads a pre-baked Showbook JWT
from SecureStore keys `e2e.test-token` + `e2e.test-user` — Maestro
seeds those keys via the e2e debug deeplink before tapping the
sign-in button. Production builds (App Store / TestFlight / Play
Store) ship with `EXPO_PUBLIC_E2E_MODE` unset, so the bypass branch
is dead code there. The pure helpers `isE2EMode` and
`loadE2ETestSession` are unit-tested in `lib/__tests__/auth.test.ts`,
including an explicit assertion that an unset env var is treated as
not-E2E so a misconfigured deploy can't accidentally ship the bypass.

### Validating flow YAML locally

Maestro flows are YAML — no device required to syntax-check them.
From the repo root:

```bash
npx maestro test --dry-run apps/mobile/e2e/flows/
```

CI runs the same step before uploading to Maestro Cloud so a typo
fails fast.

### Running flows against a local simulator (optional)

For interactive iteration on a flow you can use Maestro Studio or
the simulator-targeted CLI:

```bash
# 1. Build the app once with the e2e profile (writes to ios/build/...)
cd apps/mobile && eas build --platform ios --profile e2e --local

# 2. Boot the iOS simulator + install the .app, then launch the flow
maestro test apps/mobile/e2e/flows/sign-in.yaml \
  --env MAESTRO_E2E_TOKEN="$DEV_E2E_TOKEN" \
  --env MAESTRO_E2E_USER_JSON='{"id":"u_dev","email":"dev@showbook.test","name":"Dev User","image":null}'
```

To mint a `DEV_E2E_TOKEN` against your local web stack, hit the
`/api/auth/mobile-token` endpoint with a valid Google ID token (or
adapt the test-only route under `/api/test/*` if it exposes a JWT
shortcut). In CI those values come from the
`MAESTRO_E2E_TOKEN` / `MAESTRO_E2E_USER_JSON` repo secrets.
