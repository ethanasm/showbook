import type { ExpoConfig } from 'expo/config';
import { withAndroidManifest, type ConfigPlugin } from 'expo/config-plugins';

// Asset files in ./assets are the production brand assets — the gold
// ticket BrandMark. icon.png is 1024×1024 with the #0C0C0C background
// baked in; adaptive-icon.png is the same foreground on transparent so
// Android can composite it over the bg color below; splash.png is a
// 1080×1180 tightly-framed mark rendered as a centered logo (sized via
// the splash plugin's `imageWidth` below), not a full-bleed background;
// splash-icon-android.png is the ticket mark alone on transparency, padded
// for the Android 12+ circular splash-icon mask (see the splash plugin
// config below). The source SVG + render script live under
// `assets/logo-mocks/` so the masters stay revisable.
//
// Google Maps API key (used by react-native-maps on the Map tab):
//   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY  — single key sourced from the user's
//                                      local env (.env.local / EAS secret).
// The key is read at config-resolution time and threaded into the native
// iOS/Android Google Maps configs below. Never inline a key in this file.
// On iOS the key is optional in dev (Apple Maps is the default provider);
// on Android, react-native-maps requires Google Maps so the key must be set
// for any non-empty map.

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

// Google OAuth on native uses the *application id* (iOS bundle id / Android
// package) as the redirect URI scheme. expo-auth-session's Google provider
// calls `makeRedirectUri({ native: `${Application.applicationId}:/oauthredirect` })`
// internally — see node_modules/expo-auth-session/build/providers/Google.js
// — so for this app the redirect URI Google sends Chrome back to is
// `me.ethanasm.showbook:/oauthredirect`.
//
// On iOS, Expo's scheme config plugin automatically appends
// `ios.bundleIdentifier` to CFBundleURLSchemes ("Add the bundle identifier
// to the list of schemes for easier Google auth", in
// @expo/config-plugins build/ios/Scheme.js setScheme), so iOS catches the
// callback without any explicit scheme registration.
//
// On Android, the equivalent auto-append does NOT happen — the Android
// scheme plugin only registers what's in `expo.scheme` / `expo.android.scheme`.
// So the package name has to go in the scheme list explicitly; otherwise
// Chrome receives the redirect, finds nothing registered for
// `me.ethanasm.showbook://`, and falls through to its homepage. That's the
// symptom Brandon hit on his Play Store install on 2026-05-29 (and again
// after PR #464): Google sign-in completed, Chrome tried to redirect,
// Android had nothing registered to receive the callback, and the in-app
// browser session was lost on google.com.
//
// PR #464 registered the *reversed* Google client ID scheme
// (`com.googleusercontent.apps.<id>`) — that's what the native GIDSignIn /
// Google Sign-In Android SDKs use, NOT expo-auth-session. The redirect-URI
// logic in the provider source is unambiguous: it uses `applicationId`, with
// the reversed-client-id alternative explicitly commented out upstream.
const ANDROID_PACKAGE = 'me.ethanasm.showbook';

// E2E builds (and only E2E builds) target the loopback-only e2e backend
// stack through the emulator's host alias — EXPO_PUBLIC_API_URL is
// http://10.0.2.2:3004 (see infra/docker-compose.e2e.yml). Android
// API 28+ release builds block cleartext HTTP by default, which would
// fail every tRPC call with a network error before it left the device,
// so the e2e APK needs `android:usesCleartextTraffic="true"` in its
// manifest. Gated on EXPO_PUBLIC_E2E_MODE exactly like the auth bypass
// in lib/auth.ts: TestFlight / Play Store builds never set it, so the
// shipped manifest keeps the strict HTTPS-only policy.
const IS_E2E_BUILD = process.env.EXPO_PUBLIC_E2E_MODE === '1';

const withE2EAndroidCleartext: ConfigPlugin = (cfg) =>
  withAndroidManifest(cfg, (manifestCfg) => {
    const application = manifestCfg.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:usesCleartextTraffic'] = 'true';
    }
    return manifestCfg;
  });

const config: ExpoConfig = {
  name: 'Showbook',
  slug: 'showbook',
  owner: 'ethanasm',
  // `runtimeVersion: { policy: 'appVersion' }` (below) derives the
  // expo-updates runtime version from this string. Bumped 0.1.0 -> 0.1.1
  // with the SDK 55 -> 56 upgrade in #465 (which would otherwise leave the
  // version unchanged across an incompatible native ABI break): the
  // unbumped runtime meant OTA bundles compiled against SDK 56 APIs were
  // being shipped to SDK-55 native binaries still installed on devices
  // (iOS preview installs that hadn't been resubmitted, since iOS auto-
  // submit isn't wired). Bumping the version flips the runtime, so
  // expo-updates on the old binary refuses the incompatible bundle and
  // falls back to its embedded JS — a stale-but-consistent state instead
  // of a half-broken cross-SDK overlay. New SDK 56 builds land on 0.1.1
  // and pick up OTAs normally.
  version: '0.2.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: ['showbook', ANDROID_PACKAGE],
  userInterfaceStyle: 'automatic',
  // Splash is configured via the `expo-splash-screen` plugin below (the
  // canonical wiring as of SDK 56, which dropped the legacy top-level
  // `splash` key from ExpoConfig). The plugin carries the same image /
  // backgroundColor plus the dark variant.
  ios: {
    bundleIdentifier: 'me.ethanasm.showbook',
    supportsTablet: true,
    // ios.config must always be a defined object — Expo SDK 55's
    // withUsesNonExemptEncryption plugin does `'usesNonExemptEncryption' in
    // config.ios.config` and crashes if it's undefined. usesNonExemptEncryption
    // is the canonical place to declare the encryption-export answer; Expo
    // mirrors it into Info.plist as ITSAppUsesNonExemptEncryption.
    config: {
      usesNonExemptEncryption: false,
      ...(GOOGLE_MAPS_API_KEY ? { googleMapsApiKey: GOOGLE_MAPS_API_KEY } : {}),
    },
    // iPhone stays portrait-locked (matches the top-level `orientation`
    // above); iPad gets all four orientations so the M6.C three-pane
    // landscape layout has somewhere to live. The `~ipad` suffix is the
    // standard Info.plist device-class override.
    infoPlist: {
      UISupportedInterfaceOrientations: [
        'UIInterfaceOrientationPortrait',
      ],
      'UISupportedInterfaceOrientations~ipad': [
        'UIInterfaceOrientationPortrait',
        'UIInterfaceOrientationPortraitUpsideDown',
        'UIInterfaceOrientationLandscapeLeft',
        'UIInterfaceOrientationLandscapeRight',
      ],
      // Showbook only uses standard HTTPS — no custom crypto. Declaring
      // this here keeps App Store Connect from blocking TestFlight builds
      // on the manual "Export Compliance" question per submission.
      ITSAppUsesNonExemptEncryption: false,
      // Local dev hits the Next.js dev server on localhost from the iOS
      // simulator. Keep this scoped to localhost so production network policy
      // stays strict.
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
        NSExceptionDomains: {
          localhost: {
            NSIncludesSubdomains: true,
            NSExceptionAllowsInsecureHTTPLoads: true,
          },
        },
      },
      // Register `.pkpass` (Apple Wallet pass) as a document type
      // Showbook can open. Adds Showbook to the iOS share sheet for
      // pkpass files; LSHandlerRank=Alternate keeps the system Wallet
      // app as the default opener so a tap on a pass still adds it to
      // Wallet by default. See docs/specs/feature-plan-ios-wallet-import.md.
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'Apple Wallet Pass',
          LSItemContentTypes: ['com.apple.pkpass'],
          CFBundleTypeRole: 'Viewer',
          LSHandlerRank: 'Alternate',
        },
      ],
      // Declaring CFBundleDocumentTypes without these triggers App
      // Store Connect warning ITMS-90737 ("Missing Document
      // Configuration") on every delivery. Both are honestly NO:
      // Showbook has no UIDocumentBrowserViewController, and the
      // wallet import reads the shared pkpass once from the
      // share-sheet inbox copy (unzip → parse → discard) rather
      // than editing documents in place.
      UISupportsDocumentBrowser: false,
      LSSupportsOpeningDocumentsInPlace: false,
      // iOS 9+ requires every URL scheme passed to `canOpenURL` to be
      // declared here, otherwise the call returns false even when the
      // target app is installed. `spotify` powers the native handoff
      // from the Hype / Heard playlist cards via `buildSpotifyOpenPlan`
      // (`spotify://playlist/{id}`); `comgooglemaps` powers the "Open
      // in Google Maps" button on the venue detail hero
      // (`buildGoogleMapsOpenPlan`); without these iOS silently falls
      // back to the in-app browser.
      LSApplicationQueriesSchemes: ['spotify', 'comgooglemaps'],
    },
  },
  android: {
    package: ANDROID_PACKAGE,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0C0C0C',
    },
    // Strip the legacy library-wide read permissions from the autolinked
    // manifest. expo-image-picker still declares them for Android <= 12
    // compatibility, but Showbook's flow only invokes the system photo
    // picker (Android 13+ PhotoPicker / iOS PHPicker), which returns
    // URIs scoped to the user's explicit selection and doesn't need a
    // library-wide grant. Play's Photo and Video Permissions policy
    // rejects READ_MEDIA_* for one-time / infrequent attach flows like
    // ours; blocking here keeps the manifest aligned with how the app
    // actually behaves at runtime.
    blockedPermissions: [
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_EXTERNAL_STORAGE',
    ],
    config: GOOGLE_MAPS_API_KEY
      ? { googleMaps: { apiKey: GOOGLE_MAPS_API_KEY } }
      : undefined,
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
    'react-native-maps',
    [
      'expo-splash-screen',
      {
        // splash.png is a *tightly-framed* gold-on-black brand mark (ticket +
        // "showbook" wordmark + tagline filling the canvas — see
        // assets/logo-mocks/_build_assets.py make_splash). expo-splash-screen
        // renders `image` as a centered logo sized by `imageWidth` (dp) and
        // centered on `backgroundColor` — NOT full-bleed. `imageWidth` keeps
        // the mark a moderate, centered size (~half a phone's width); do NOT
        // add `enableFullScreenImage_legacy` — it forces iOS into full-screen
        // aspect-fit, which blows the logo up to the full width.
        //
        // `image` MUST stay set. withAndroidSplashStyles unconditionally emits
        // `windowSplashScreenAnimatedIcon -> @drawable/splashscreen_logo`, but
        // that drawable is only generated when an image is present — an
        // image-less config fails the release Android build at
        // `processReleaseResources` ("resource drawable/splashscreen_logo not
        // found"). To make the splash blank, point at a blank image; don't drop
        // the key.
        image: './assets/splash.png',
        // Keep in sync with SPLASH_IMAGE_WIDTH in lib/splash.ts (BrandSplash's
        // box) — app.config.ts can't import it (the Expo config loader doesn't
        // resolve transitive .ts imports), so the coupling is enforced by
        // lib/__tests__/splash.test.ts instead.
        imageWidth: 200,
        backgroundColor: '#0C0C0C',
        resizeMode: 'contain',
        // Dark-mode variant. Kicks in when userInterfaceStyle resolves
        // to `dark`. Showbook is dark-everywhere so this differs only
        // in the explicit `backgroundColor` hint to native splash; the
        // asset is already gold-on-#0C0C0C so it reuses the same file.
        dark: {
          image: './assets/splash.png',
          imageWidth: 200, // keep in sync with SPLASH_IMAGE_WIDTH (see above)
          backgroundColor: '#0C0C0C',
          resizeMode: 'contain',
        },
        // Android 12+ always clips the native splash icon
        // (`windowSplashScreenAnimatedIcon`) into a circular mask. splash.png
        // is a rectangle with the #0C0C0C background baked in, so the OS
        // splash showed it as a clipped dark disc — a visible ring flash
        // before <BrandSplash/> mounted. Android therefore gets its own
        // asset: ticket mark only, transparent background, padded to fit the
        // 2/3-diameter masked safe zone (see make_android_splash_icon in
        // assets/logo-mocks/_build_assets.py). imageWidth / backgroundColor /
        // resizeMode inherit from the root props above; iOS (no mask) keeps
        // splash.png.
        android: {
          image: './assets/splash-icon-android.png',
          dark: {
            image: './assets/splash-icon-android.png',
          },
        },
      },
    ],
    [
      'expo-image-picker',
      {
        // Permission strings shown by iOS when the user is asked to grant
        // access to photo library / camera. The picker is launched from the
        // M4 upload sheet to attach photos and video to a past show.
        photosPermission:
          'Showbook needs access to your photos so you can add memories from shows you\'ve attended.',
        cameraPermission:
          'Showbook needs access to your camera so you can capture moments from shows you\'ve attended.',
      },
    ],
    // Local Expo Module wrapping the Spotify App Remote SDK. The plugin
    // injects `SpotifyClientID` into Info.plist, pins the SpotifyiOS
    // pod, and declares `com.spotify.music` in `<queries>` for Android
    // API 30+. Module source lives in `modules/showbook-spotify-sdk/`.
    './modules/showbook-spotify-sdk/plugin/index.js',
  ],
  experiments: {
    typedRoutes: true,
  },
  updates: {
    url: 'https://u.expo.dev/24b77f4d-8ac8-4fac-9920-3ee9155e51f6',
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
  extra: {
    eas: {
      projectId: '24b77f4d-8ac8-4fac-9920-3ee9155e51f6',
    },
  },
};

// Config plugins are plain `config → config` functions, so the e2e-only
// cleartext mod is applied to the export directly rather than via the
// `plugins` array (whose ExpoConfig type models app.json and only
// admits string / tuple entries). Non-e2e builds export `config`
// untouched — the mod never exists in their plugin graph.
export default IS_E2E_BUILD ? withE2EAndroidCleartext(config) : config;
