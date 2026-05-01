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
