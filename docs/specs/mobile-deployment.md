# Mobile deployment guide

How to (1) run the Showbook mobile app on your own iPhone during development
and (2) ship it to the App Store and Google Play. This is opinionated to the
state of `apps/mobile` today (Expo SDK 55, Expo Router, native Google OAuth
via `expo-auth-session`, `expo-secure-store`, `expo-notifications`).

> Status: written 2026-05-01, updated 2026-06-10. The app is now
> feature-complete (M1–M6) and an EAS project + `eas.json` exist
> (`extra.eas.projectId` is wired). Real brand artwork (icon / adaptive
> icon / splash) is committed under `apps/mobile/assets/`. **`preview`
> (internal-distribution) builds are installed and running on a physical
> iOS and a physical Android device (one each)** — so the EAS project, the
> iOS ad-hoc provisioning / device registration, the Google OAuth client
> IDs, and the backend `/api/auth/mobile-token` audience are all proven
> end-to-end. What remains before a first *store* submission is the
> store-account setup (App Store Connect + Play app records, reviewer
> demo account) and wiring the `production` EAS profile's `EXPO_PUBLIC_*`
> env (it has no inline block — including the Maps key, which is already
> wired for `preview`). See the checklist at the bottom. The steps below
> are the path forward; the per-step notes call out what's already done.

---

## Operator runbook (concrete sequence)

The command-forward path from where the project is now to testers and the
stores. The Parts below carry the full detail and rationale; this is the
sequence you actually run. Bundle ID / package: `me.ethanasm.showbook`.

**Already done (one-time):** Expo/EAS login, Apple Developer Program, Play
Console account, the iOS/Android/web OAuth client IDs (in `eas.json`
`preview.env`), backend `GOOGLE_OAUTH_MOBILE_AUDIENCES`, brand assets, a
restricted Maps SDK for Android key (in `preview.env`, locked to the
package + EAS keystore **and** Play app-signing SHA-1s), and on-device
`preview` builds on iOS + Android.

**1 — Pre-flight (every build).**

```bash
pnpm mobile:typecheck && pnpm mobile:lint && pnpm mobile:test
# version: hands-off — the mobile-deploy workflow bumps app.config.ts
# automatically on the build path (see "Versioning" below). Only edit
# the version by hand for the deliberate 1.0.0 jump; the workflow
# detects the manual change and won't double-bump. EAS auto-bumps
# buildNumber/versionCode either way.
```

**2 — Beta to testers (no public release).** Uses the `preview-store`
profile, which inherits `preview.env` — so every `EXPO_PUBLIC_*` (incl. the
Maps key) is already baked in and you do **not** need the production env
vars from step 3 yet.

```bash
# Android → Play internal testing
eas build  --profile preview-store --platform android
eas submit --profile preview-store --platform android --latest   # → Play 'internal' track

# iOS → TestFlight
eas build  --profile preview-store --platform ios
eas submit --profile preview-store --platform ios --latest       # first run prompts for an App Store Connect API key
```

Then add testers: Play Console → Testing → Internal testing → tester
emails + opt-in link; App Store Connect → TestFlight → Internal Testing →
up to 100 testers, no review.

**3 — Production env (once, before any `production`-profile build).** The
`production` profile has no inline `env`; set each var as an EAS env var
(`eas env:create --help` for exact flags on your CLI version):

```bash
eas env:create --environment production --visibility plaintext --name EXPO_PUBLIC_API_URL                     --value https://showbook.ethanasm.me
eas env:create --environment production --visibility plaintext --name EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS     --value <ios-client-id>
eas env:create --environment production --visibility plaintext --name EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID --value <android-client-id>
eas env:create --environment production --visibility plaintext --name EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB     --value <web-client-id>
eas env:create --environment production --visibility plaintext --name EXPO_PUBLIC_GOOGLE_MAPS_API_KEY            --value <maps-key>
eas env:list   --environment production    # verify before building
```

**4 — Store release (production).** Prereqs: App Store Connect + Play app
records; legal URLs live (`/privacy`, `/terms`, `/account-deletion`) with
`LEGAL_CONTACT_EMAIL` in `.env.prod`; a demo Google account for Apple's
reviewer.

```bash
eas build  --profile production --platform all
eas submit --profile production --platform all --latest
```

- App Store Connect → new version → attach build → screenshots (6.7" / 6.1" / iPad) → demo account in *App Review Information* → Submit for Review.
- Play Console → Production → new release → attach AAB → release notes → staged rollout (start 10–20%).

**5 — Ongoing.**

```bash
eas update --branch production --message "..."   # JS/asset only — ships in seconds, no store review
# native deps / app.config.ts / permissions changed → fresh build + submit (steps 1 + 4)
```

---

## Versioning (decision D25 in `decisions.md`)

Plain numeric SemVer in `app.config.ts` — **no pre-release suffixes**:
`1.0.0-beta.1` is not a valid iOS `CFBundleShortVersionString` (Apple
accepts at most three period-separated integers) and would fail the
App Store Connect upload.

- **Beta era (now):** every `preview-store` build stays on the
  `0.MINOR.PATCH` line — MINOR for a feature batch, PATCH for a
  fix-only build. The 0.x line *is* the beta marker.
- **`1.0.0`** is the first `production`-profile store submission.
- **After 1.0:** "beta" becomes a distribution property, not a version
  property — a `1.x` build hits TestFlight / Play internal first, and
  the same artifact is promoted to public. The `preview` vs
  `production` update channels keep the OTA streams apart.
- **Build number** (`build 7` on the device today) is EAS's
  auto-incremented counter (`appVersionSource: "remote"` +
  `autoIncrement`) — monotonic per platform, never reset, never set by
  hand, no meaning beyond "newer upload".
- **When to bump:** any native change (SDK, native dep,
  `app.config.ts`, permissions) MUST bump the version —
  `runtimeVersion: { policy: 'appVersion' }` derives the OTA runtime
  from it, so the bump is what stops old binaries from accepting
  incompatible bundles (the 0.1.0 → 0.1.1 SDK-56 lesson). JS-only
  releases ship via `eas update` **without** a bump; bumping for an
  OTA-only release would target a runtime no installed binary has.

**Bumping is automated.** The `mobile-deploy.yml` workflow owns it on
the build path (and only there — the OTA path never bumps, per the
rule above):

- Before `eas build`, the workflow runs
  `scripts/bump-mobile-version.mjs`, commits the new version back to
  `main` (`chore(release): mobile vX.Y.Z [skip ci]`), tags it
  `mobile-vX.Y.Z`, pushes, then builds. The tag history doubles as the
  release log.
- **Minor vs patch** comes from a conventional-commit scan of the
  squash-merge subjects on `main` since the last `mobile-v*` tag
  (everything in that range rides the new binary, including changes
  already OTA-shipped under the old version): any `feat:` /
  `feat(scope):` subject → minor; a breaking marker (`type!:`) →
  major, which maps to minor while we're pre-1.0 (D25); anything
  unprefixed → patch. **Prefix feature PR titles with `feat:`** —
  squash-merge makes the PR title the commit subject the scan reads.
  An unprefixed feature ships as a patch bump, which is harmless but
  loses the signal.
- The `workflow_dispatch` build mode has a `bump` input
  (`auto`/`patch`/`minor`/`none`) to override the scan; `none` ships
  whatever version is already in `app.config.ts`.
- A **manual** version edit in the triggering merge (e.g. the 1.0.0
  jump) is detected and respected — the workflow ships it without
  bumping again.
- The bump-back push uses `GITHUB_TOKEN`, whose pushes never trigger
  workflows, so it can't re-trigger CI or the deploy (the `[skip ci]`
  in the message is belt-and-braces).

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
   `docs/specs/infrastructure.md`.
2. Google OAuth client IDs created in Google Cloud Console:
   - **iOS** client (type: iOS) with bundle ID `me.ethanasm.showbook`.
   - **Android** client (type: Android) with package `me.ethanasm.showbook`
     and the SHA-1 of the signing cert (EAS prints this after the first
     Android build).
3. The backend's `GOOGLE_OAUTH_MOBILE_AUDIENCES` env var set to the
   comma-separated list of those two client IDs, so
   `/api/auth/mobile-token` accepts the ID tokens the app mints. See
   `apps/mobile/README.md`.

**App identity (already set in `app.config.ts`)**

- Bundle ID / package: `me.ethanasm.showbook`
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

### 2.1 Brand assets (done)

Real artwork is already committed under `apps/mobile/assets/` and wired
through `app.config.ts` (the gold-ticket BrandMark — source SVG + render
script live under `assets/logo-mocks/`):

- `icon.png` — 1024×1024, **no alpha** (RGB), `#0C0C0C` background baked
  in. Apple rejects icons with alpha / non-1024², so keep it RGB.
- `adaptive-icon.png` — 1024×1024 RGBA foreground composited over
  `android.adaptiveIcon.backgroundColor` (`#0C0C0C`).
- `splash.png` — 1080×1180 centered mark. Note the native splash is
  deliberately image-less black (see the `expo-splash-screen` plugin in
  `app.config.ts`); the visible logo is the JS `<BrandSplash/>`.

No action needed here — this section is kept as a record of the asset
contract. If you re-render the masters, preserve those formats.

### 2.2 Create the App Store Connect record

1. Go to <https://appstoreconnect.apple.com> → My Apps → +.
2. Bundle ID: `me.ethanasm.showbook` (must match `app.config.ts`).
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

### Android Maps key (do this before the `.aab` build)

The Map tab uses Google Maps on Android (`react-native-maps` →
`PROVIDER_GOOGLE`), which needs a **Maps SDK for Android** key baked into
the build. iOS uses Apple Maps and needs no key.

**Committing a *restricted* key to `eas.json` `preview.env` is fine** —
same posture as the OAuth client IDs already there. A Maps key isn't a
secret: it ships inside the APK/AAB, so anyone can extract it. Security
comes from restrictions, not from hiding it. Lock it down *before* you
commit.

1. Google Cloud Console → the project you already use for Places/OAuth.
   Confirm **billing is enabled** (Maps requires it even within the free
   monthly credit).
2. **APIs & Services → Library → enable "Maps SDK for Android"** (distinct
   from Places / Maps SDK for iOS).
3. **Credentials → Create credentials → API key** (you get an `AIza…`).
4. Edit the key → **Application restrictions → Android apps**, add **two**
   package + SHA-1 entries:
   - `me.ethanasm.showbook` + the **EAS keystore SHA-1**
     (`eas credentials -p android` → the profile's keystore shows it).
   - `me.ethanasm.showbook` + the **Play app-signing SHA-1** (Play Console
     → your app → Test and release → App integrity → App signing). Play
     re-signs the app, so without this the map breaks once delivered
     through Play. One key can hold multiple package+SHA-1 entries.
5. **API restrictions → Restrict key → Maps SDK for Android** only. Save.
6. Provide it to the build: `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` in `eas.json`
   `preview.env` (and an EAS env var for `production`, which has no inline
   `env`). **Rebuild** — the key is baked at build time, so an OTA
   `eas update` won't apply it.

A restriction mismatch fails **silently** (blank gray map, no error), so
if the map is blank with the key present, re-check the SHA-1s.

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

## Beta (TestFlight + Play internal testing)

"Beta" here means getting the app to real testers **without** a full public
store release. It's a subset of Part 2 / Part 3 — same artifacts, fewer
review gates:

- **iOS — TestFlight internal testing.** Build the `production` (or
  `preview-store`) profile, `eas submit` to App Store Connect, then add
  testers under TestFlight → Internal Testing (up to 100, no Apple review,
  live within minutes). External testing (up to 10 000) needs a one-time
  ~24 h beta review. The Map tab uses Apple Maps on iOS, so no Maps key is
  required for the iOS beta.
- **Android — Play internal testing.** Build `preview-store` (app-bundle)
  and `eas submit --profile preview-store --platform android` (its submit
  config targets the `internal` track). Internal testing is instantaneous.
  The Android Map tab needs `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` wired into the
  build (see the checklist) or it renders blank.
- **Known beta caveat — push notifications.** The Preferences push toggle
  and the permission prompt are live, but server-side delivery isn't wired
  yet (`docs/specs/planned-improvements.md`). Testers can flip the toggle
  and will never receive a push — call this out in your beta notes, or hide
  the toggle for the beta build.

Both beta tracks share the same backend prerequisites as production:
`GOOGLE_OAUTH_MOBILE_AUDIENCES` set on the backend, and the backend
reachable at the `EXPO_PUBLIC_API_URL` baked into the build.

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

- [x] **`preview` internal builds installed + running on a physical iOS
      and a physical Android device** (one each) — proves the EAS project,
      iOS ad-hoc provisioning / device registration, and Android APK install.
- [x] Apple Developer Program active (required for the on-device iOS
      internal / ad-hoc build).
- [x] Google Play Console account active. *(eas.json's `preview-store`
      submit config already targets the Play `internal` track via
      `play-service-account.json`.)*
- [x] iOS + Android OAuth client IDs created in Google Cloud Console
      (inlined in `eas.json` `preview.env`; native sign-in works on-device).
- [x] Backend `GOOGLE_OAUTH_MOBILE_AUDIENCES` set in `.env.prod`, backend
      redeployed. *(Proven: sign-in succeeds on the preview builds against
      `https://showbook.ethanasm.me`.)*
- [x] `apps/mobile/assets/icon.png`, `splash.png`, `adaptive-icon.png`
      are real brand artwork (see § 2.1).
- [x] `apps/mobile/eas.json` exists with a `production` profile and
      `autoIncrement: true`.
- [ ] `production` EAS profile resolves the required client env —
      `EXPO_PUBLIC_API_URL`, the iOS/Android/web `GOOGLE_OAUTH_CLIENT_ID_*`,
      and `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`. Unlike `preview`, the
      `production` profile carries no inline `env` block, so these must
      come from EAS environment variables/secrets. Confirm with
      `eas env:list --environment production` before the first build —
      an unset `EXPO_PUBLIC_API_URL` ships a build with a broken backend
      and dead sign-in.
- [x] Map tab on Android (preview): `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is
      wired into `eas.json` `preview.env` (inherited by `preview-store`) —
      a *restricted* "Maps SDK for Android" key (Application restriction:
      package `me.ethanasm.showbook` + EAS keystore SHA-1; API restriction:
      Maps SDK for Android only; a *separate* key from the backend
      `GOOGLE_PLACES_API_KEY`). `preview` / `preview-store` Android builds
      now render the map after a rebuild. iOS uses Apple Maps (`map.tsx`
      picks `PROVIDER_DEFAULT`) and needs no key.
- [x] Play app-signing SHA-1 added to the restricted Maps key — covers
      Play-delivered Android installs (Play re-signs the app, so the EAS
      keystore SHA-1 alone wouldn't). *(The `production` profile still
      needs the Maps key as an EAS env var — covered by the `production`
      env item above.)*
- [ ] Legal pages reachable at public URLs and pasted into both consoles:
      `/privacy`, `/terms`, and `/account-deletion` (Google Play *requires*
      the data-deletion URL). They live under `apps/web/app/(public)/`; the
      contact address is env-driven — set `LEGAL_CONTACT_EMAIL` (and
      `LEGAL_GOVERNING_LAW`) in `.env.prod` so the pages don't show the
      `@showbook.app` placeholder. Apple also wants a support URL.
- [ ] App Store Connect + Play Console app records created with bundle
      ID `me.ethanasm.showbook`.
- [ ] Demo Google account ready to hand to Apple's reviewer.
