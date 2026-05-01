# Mobile deployment guide

How to (1) run the Showbook mobile app on your own iPhone during development
and (2) ship it to the App Store and Google Play. This is opinionated to the
state of `apps/mobile` today (Expo SDK 55, Expo Router, native Google OAuth
via `expo-auth-session`, `expo-secure-store`, `expo-notifications`).

> Status: written 2026-05-01. The mobile app is mid-M1; no EAS project,
> no Apple/Google developer accounts, and no `eas.json` exist yet. The
> steps below are the *path forward*, not a record of what's been done.

---

## Prerequisites (one-time, both platforms)

**Accounts and tooling**

- Apple Developer Program membership — **$99/year**, sign up at
  <https://developer.apple.com/programs/>. Approval takes a few hours to a
  few days. Required for both ad-hoc device installs (free 7-day profiles
  aside) and App Store submission.
- Google Play Console account — **$25 one-time**, sign up at
  <https://play.google.com/console/signup>.
- macOS with Xcode 15+ installed (only required if you want local iOS
  builds; EAS Build in the cloud removes this requirement).
- `pnpm install` at repo root (already wired up by the session-start hook).
- Expo account: `pnpm dlx expo login` (free tier is fine to start).
- EAS CLI: `pnpm dlx eas-cli login` (we'll use EAS Build to avoid having
  to maintain a local Xcode + Android Studio toolchain).

**Backend prerequisites**

Before either dev or prod builds talk to your backend you need:

1. `EXPO_PUBLIC_API_URL` pointing at a reachable backend. For dev that
   can be your laptop over `expo start --tunnel`; for prod it's the
   Cloudflare Tunnel hostname documented in
   `showbook-specs/infrastructure.md`.
2. Google OAuth client IDs created in Google Cloud Console:
   - **iOS** client (type: iOS) with bundle ID `com.showbook.app`.
   - **Android** client (type: Android) with package `com.showbook.app`
     and the SHA-1 of the signing cert (EAS prints this after the first
     Android build).
3. The backend's `GOOGLE_OAUTH_MOBILE_AUDIENCES` env var set to the
   comma-separated list of those two client IDs, so
   `/api/auth/mobile-token` accepts the ID tokens the app mints. See
   `apps/mobile/README.md`.

**App identity (already set in `app.config.ts`)**

- Bundle ID / package: `com.showbook.app`
- Slug: `showbook`
- Display name: `Showbook`

These are what App Store Connect and Google Play will key off of, so
**don't change them after the first store submission** — once the
bundle ID is registered to a Showbook app record, it can't be reused.

---

## Part 1 — Run on your own iPhone (dev)

You have two options. Pick (B) if you ever want to test push
notifications, deep linking from outside Expo Go, or anything that needs
custom native code; pick (A) for a 60-second smoke test.

### Option A — Expo Go (fastest, limited)

Expo Go is Apple's hosted Expo runtime; it runs your JS bundle inside
their pre-built shell. Caveats: `expo-notifications` push delivery is
removed from Expo Go on SDK 53+, and any future native module we add
(e.g. a custom Sentry integration) will silently no-op. Fine for UI
work, not fine for auth + push end-to-end.

1. Install **Expo Go** from the App Store on your iPhone.
2. Make sure your phone and laptop are on the same Wi-Fi (or use
   `--tunnel`).
3. From the repo root:
   ```bash
   pnpm --filter mobile start
   # or, if Wi-Fi is flaky / you're tethered:
   pnpm --filter mobile exec expo start --tunnel
   ```
4. Scan the QR code in the terminal with the iPhone Camera app. It will
   open Expo Go and load the bundle.

### Option B — Dev client on a physical device (recommended)

A dev client is a custom build of the app that includes our exact native
modules, but loads JS over the Metro bundler the same way Expo Go does.
This is the build you'll iterate on day-to-day.

**One-time setup**

1. Add the dev-client package and an `eas.json`:
   ```bash
   pnpm --filter mobile add expo-dev-client
   pnpm --filter mobile exec eas init        # creates the EAS project, writes projectId into app.config.ts extra.eas
   pnpm --filter mobile exec eas build:configure
   ```
   `eas build:configure` writes `apps/mobile/eas.json` with three
   profiles: `development`, `preview`, `production`. Confirm the
   `development` profile has `"developmentClient": true` and
   `"distribution": "internal"`.

2. Register your iPhone's UDID with Apple:
   ```bash
   pnpm --filter mobile exec eas device:create
   ```
   This opens a URL on your phone that installs an ad-hoc provisioning
   profile. Apple caps you at 100 device slots per year per
   bundle ID — fine for personal testing.

**Each time you change native deps (or first build)**

```bash
pnpm --filter mobile exec eas build --profile development --platform ios
```

EAS builds in the cloud (~15 min first time, ~5 min cached). When it
finishes it prints an install URL — open that on the iPhone in Safari,
install the dev client, trust the developer profile in
**Settings → General → VPN & Device Management**.

**Day-to-day loop**

```bash
pnpm --filter mobile start --dev-client
```

Open the installed Showbook dev client on the iPhone, point it at the
Metro URL printed in the terminal (or scan the QR), and you're iterating
with hot reload. You only need a fresh `eas build` when `package.json`
native deps or `app.config.ts` plugins change — pure JS edits don't
require a rebuild.

**TestFlight as a dev distribution channel**

Once you're past M1 and want to hand a build to a friend, the easiest
path is to skip ad-hoc provisioning entirely and ship a TestFlight
build (see Part 2 — TestFlight is the same artifact whether you call
it "internal testing" or "the path to App Store").

---

## Part 2 — Ship to the App Store (iOS)

### 2.1 Replace placeholder assets

`apps/mobile/app.config.ts` currently points at 1×1 placeholder PNGs.
Apple will reject the submission if the icon contains alpha or doesn't
match 1024×1024. Replace, in `apps/mobile/assets/`:

- `icon.png` → 1024×1024, no alpha, no rounded corners (Apple rounds them).
- `splash.png` → at least 1242×2688, centered logo on the brand
  background `#0C0C0C`.
- `adaptive-icon.png` → 432×432 foreground (Android, but do it now).

### 2.2 Create the App Store Connect record

1. Go to <https://appstoreconnect.apple.com> → My Apps → +.
2. Bundle ID: `com.showbook.app` (must match `app.config.ts`).
3. SKU: `showbook-ios` (any unique string).
4. Fill in: name, subtitle, primary category (suggest "Lifestyle" or
   "Entertainment"), age rating questionnaire, privacy policy URL,
   support URL, marketing URL (optional).
5. App Privacy: declare the data we collect — at minimum *Email
   Address* and *User ID* (linked to identity, used for app
   functionality). If you ship analytics later, declare it.
6. Encryption: select "uses only standard encryption" (HTTPS counts);
   that avoids the export-compliance review.

### 2.3 Build a release artifact

```bash
pnpm --filter mobile exec eas build --profile production --platform ios
```

EAS will:

- Generate a Distribution certificate and an App Store provisioning
  profile (it asks once, then caches in EAS).
- Bump the iOS `buildNumber` automatically (set
  `"autoIncrement": true` in the `production` profile of `eas.json`).
- Produce a signed `.ipa`.

### 2.4 Submit to TestFlight (and then App Store)

```bash
pnpm --filter mobile exec eas submit --profile production --platform ios --latest
```

This uploads the `.ipa` to App Store Connect via the API. Apple's
processing takes 10–30 min, after which the build shows up under
**TestFlight**:

- **Internal testing** (up to 100 of your own team) — no review,
  available within minutes.
- **External testing** (up to 10 000 testers) — requires a one-time
  beta review (~24 h).

When you're ready for the real submission:

1. In App Store Connect, on the app's *App Store* tab, create a new
   version, attach the build from TestFlight, fill in screenshots
   (6.7", 6.1", and iPad if `supportsTablet` is true — currently it
   is), description, keywords, what's new.
2. Click **Submit for Review**. Apple's median review time is ~24–48 h.
   Common rejection reasons for an app like this: broken sign-in for
   the reviewer (provide a demo Google account in *App Review
   Information*), insufficient privacy policy.

---

## Part 3 — Ship to Google Play (Android)

### 3.1 Create the Play Console app

1. <https://play.google.com/console> → Create app.
2. Default language, app name "Showbook", type "App", free.
3. Complete the *App content* checklist: privacy policy URL, ads
   declaration, content rating questionnaire, target audience, data
   safety form (mirrors Apple's privacy declarations — email + user ID
   for app functionality).

### 3.2 Build an `.aab`

```bash
pnpm --filter mobile exec eas build --profile production --platform android
```

The first time, EAS will offer to generate an upload keystore and store
it server-side — accept. (If you ever need to migrate off EAS, you can
download the keystore later; do not lose it, Google won't let you
re-upload under the same package name with a different key.)

After the first build finishes, EAS prints the SHA-1 of the upload
key. **Add that SHA-1 to your Android OAuth client in Google Cloud
Console** so production sign-in works.

### 3.3 Submit

```bash
pnpm --filter mobile exec eas submit --profile production --platform android --latest
```

This uploads the `.aab` to Play Console. From there:

1. Promote the build through tracks: **Internal testing** → **Closed
   testing** → **Open testing** → **Production**. Internal testing is
   instantaneous; production review takes a few days the first time
   (because it's a new app), then hours for updates.
2. On the *Production* track, fill in the release notes and roll out.
   Default to a **staged rollout** (start at 10–20 %) so you can halt
   if something breaks.

---

## Ongoing release workflow

Once both stores have at least one approved version, the steady-state
loop is:

```bash
# bump JS-only? Use OTA updates and skip the stores entirely:
pnpm --filter mobile exec eas update --branch production --message "Fix copy on Add screen"

# bump native deps or app.config.ts? Cut new store builds:
pnpm --filter mobile exec eas build --profile production --platform all
pnpm --filter mobile exec eas submit --profile production --platform all --latest
```

OTA updates (`eas update`) ship JS/asset changes to already-installed
copies in seconds and don't require a store review. Anything that
touches `package.json` native deps, `app.config.ts` plugins, or
permissions strings does require a new store build.

Bump `version` in `app.config.ts` for each user-visible release; EAS
auto-bumps `ios.buildNumber` and `android.versionCode` if you set
`"autoIncrement": true` in the production profile.

---

## Checklist before the first submission

- [ ] Apple Developer Program active.
- [ ] Google Play Console account active.
- [ ] iOS + Android OAuth client IDs created in Google Cloud Console.
- [ ] Backend `GOOGLE_OAUTH_MOBILE_AUDIENCES` set in `.env.prod`,
      backend redeployed.
- [ ] `apps/mobile/assets/icon.png`, `splash.png`, `adaptive-icon.png`
      replaced with real artwork.
- [ ] `EXPO_PUBLIC_API_URL` points at the prod Cloudflare tunnel
      hostname in the `production` EAS profile.
- [ ] `apps/mobile/eas.json` exists with `production` profile and
      `autoIncrement: true`.
- [ ] Privacy policy and support URLs published (link from the
      Showbook web app footer is fine).
- [ ] App Store Connect + Play Console app records created with bundle
      ID `com.showbook.app`.
- [ ] Demo Google account ready to hand to Apple's reviewer.
