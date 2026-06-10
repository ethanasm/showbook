# Showbook Mobile

Expo + TypeScript app for Showbook. See
[`docs/specs/mobile-roadmap.md`](../../docs/specs/mobile-roadmap.md)
for the milestone plan.

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
pnpm start         # Metro bundler for the development client
pnpm ios           # build + install the iOS development client
pnpm android       # build + install the Android development client
pnpm ios:go        # Expo Go only; Google sign-in will not work there
pnpm android:go    # Expo Go only; Google sign-in will not work there
pnpm typecheck
pnpm lint
pnpm test
```

Or use the repo-root shortcuts (`pnpm mobile:start`, `pnpm mobile:ios`,
`pnpm mobile:ios:go`, `pnpm mobile:typecheck`, etc.) — they forward
to this package.

## Test coverage

The mobile app runs an 80% line / branch / function coverage gate
scoped to **`apps/mobile/lib/**` only**. Layout-heavy code under
`app/` and `components/` is intentionally excluded — see
[`docs/specs/mobile-testing-strategy.md`](../../docs/specs/mobile-testing-strategy.md)
for the rationale and the test plan. The gate is
enforced by `pnpm verify:coverage` (run on every PR by CI), which
merges per-package LCOV via `scripts/coverage-report.mjs`. Locally:

```bash
pnpm test:coverage   # writes coverage/mobile-unit.info
```

The gate is independent from web's 80% gate — a breach in either
scope fails CI, and the report identifies which scope fell short.

## Environment variables

Set these locally via shell or `.env.local` (copy `.env.example` to
start). Mobile-side vars are
prefixed `EXPO_PUBLIC_` so Expo inlines them at build time.

| Var | Default | Required for |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | - | tRPC client target. Use `https://localhost:3001` for an iOS simulator pointed at the local web stack with the dev cert, or a LAN/tunnel URL for a physical device. |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS` | - | Sign in with Google on iOS |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID` | - | Sign in with Google on Android |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB` | - | Sign-in on **every** platform — `expo-auth-session` uses the web client ID as the ID-token audience on native iOS/Android too, so it's required, not web-preview-only. |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | - | The Map tab (`react-native-maps`). Optional on iOS (Apple Maps is the default provider); **required on Android** or the map renders blank. Resolved at build time from your local `.env.local`/shell or an EAS env/secret — see [`docs/specs/mobile-deployment.md`](../../docs/specs/mobile-deployment.md). Not a backend/`.env.prod` var. |

The backend (`apps/web`) needs `GOOGLE_OAUTH_MOBILE_AUDIENCES` set
to the comma-separated list of these client IDs so it accepts the
mobile-issued ID tokens at `POST /api/auth/mobile-token`.

Google sign-in must run from a development build or signed native
build. Expo Go uses an `exp://...` redirect URI, which Google rejects
for this native OAuth flow. If the iOS status bar back label says
`Expo Go`, you are still in the wrong runtime. For local simulator
testing, run `pnpm mobile:ios` once after native dependency changes,
then use `pnpm mobile:start` for subsequent JS-only reloads.

For the local web stack, set `EXPO_PUBLIC_API_URL=https://localhost:3001`
before starting Metro so the OAuth token exchange posts to the dev
server using the trusted local cert. If this native config changes,
rebuild the development client with `pnpm mobile:ios`; Metro reloads
alone will not update `Info.plist`.

`pnpm mobile:ios` attempts to install the mkcert root CA, or a local
HTTPS root cert, into the booted iOS simulator. If your cert lives
outside the common mkcert path, run:

```bash
MKCERT_ROOT_CA=/absolute/path/to/rootCA.pem pnpm mobile:ios
```

## Status

See [`docs/specs/mobile-roadmap.md`](../../docs/specs/mobile-roadmap.md)
for the milestone plan, what's shipped, and what's next.

## Maestro E2E flows

Three flows live under `e2e/flows/` — sign-in, add-show, sign-out.
The Android workflow runs them nightly + on push-to-`main` + on PRs
labeled `mobile-visual` via `.github/workflows/mobile-e2e.yml`; iOS
is manual (`pnpm mobile:e2e:ios`) on the dev Mac. See
`docs/specs/mobile-testing-strategy.md` § Wave F.

The `e2e` EAS profile (see `eas.json`) sets `EXPO_PUBLIC_E2E_MODE=1`,
which flips `lib/auth.ts` into bypass mode. With that flag on,
`loadE2ETestSession` reads a pre-baked Showbook JWT from two
sources, in order:

1. The bundle-time env vars `EXPO_PUBLIC_E2E_TEST_TOKEN` and
   `EXPO_PUBLIC_E2E_TEST_USER_JSON`. These are inlined into the APK
   at build time by CI, so the sign-in tap returns a valid session
   without any in-app deeplink seeding step.
2. SecureStore keys `e2e.test-token` and `e2e.test-user`, as a
   fallback if a future change reintroduces a debug deeplink handler.

Production builds (App Store / TestFlight / Play Store) ship with
`EXPO_PUBLIC_E2E_MODE` unset, so the bypass branch is dead code
there. The pure helpers `isE2EMode` and `loadE2ETestSession` are
unit-tested in `lib/__tests__/auth.test.ts`, including an explicit
assertion that an unset env var is treated as not-E2E so a
misconfigured deploy can't accidentally ship the bypass.

### Validating flow YAML locally

Maestro flows are YAML — no device required to syntax-check them.
From the repo root:

```bash
pnpm mobile:e2e:dry
```

The Android workflow runs the same step before booting the emulator
so a typo fails fast.

### Running flows against a local simulator (optional)

For interactive iteration on a flow on a local iOS simulator:

```bash
# 1. Export the test session so it gets inlined into the dev build
export EXPO_PUBLIC_E2E_MODE=1
export EXPO_PUBLIC_E2E_TEST_TOKEN="$DEV_E2E_TOKEN"
export EXPO_PUBLIC_E2E_TEST_USER_JSON='{"id":"u_dev","email":"dev@showbook.test","name":"Dev User","image":null}'

# 2. Build + install the development client onto the booted simulator
pnpm mobile:ios

# 3. Once the app is installed, run the flows
pnpm mobile:e2e:ios
```

To mint a `DEV_E2E_TOKEN` against your local web stack, hit the
`/api/auth/mobile-token` endpoint with a valid Google ID token (or
adapt the test-only route under `/api/test/*` if it exposes a JWT
shortcut). In CI those values come from the
`MAESTRO_E2E_TOKEN` / `MAESTRO_E2E_USER_JSON` repo secrets and are
exposed to the build step as `EXPO_PUBLIC_E2E_TEST_TOKEN` /
`EXPO_PUBLIC_E2E_TEST_USER_JSON`.
