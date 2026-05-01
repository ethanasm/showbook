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

## Environment variables

Set these (locally via shell or `.env.local`; see `.env.local.example` once it exists):

| Var | Default | Required for |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://showbook.example.com` | tRPC client target (M5+ for real data) |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS` | - | Sign in with Google on iOS (M1) |
| `EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID` | - | Sign in with Google on Android (M1) |

The backend (`apps/web`) needs `GOOGLE_OAUTH_MOBILE_AUDIENCES` set
to the comma-separated list of these client IDs so it accepts the
mobile-issued ID tokens.

## Status

M1 (Foundation) in progress. See `showbook-specs/mobile-roadmap.md`.
