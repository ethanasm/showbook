import type { ExpoConfig } from 'expo/config';

// Asset files in ./assets are the production brand assets — the gold
// ticket BrandMark. icon.png is 1024×1024 with the #0C0C0C background
// baked in; adaptive-icon.png is the same foreground on transparent so
// Android can composite it over the bg color below; splash.png is
// 1284×2778 (iPhone 14 Pro Max) and resizeMode 'cover' trims it on
// smaller devices. The source SVG + render script live under
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

// Google OAuth on native uses the *reversed* client ID as a custom URI scheme
// for the redirect back from Chrome / SFSafariViewController:
//   "222563763412-noa3...apps.googleusercontent.com"
//      → scheme "com.googleusercontent.apps.222563763412-noa3..."
//      → redirect URI "com.googleusercontent.apps.222563763412-noa3...:/oauth2redirect"
// Android needs an intent-filter on the main activity that claims this scheme,
// otherwise Chrome can't hand the OAuth callback back to the app and the
// system falls through to the launcher home screen — which is exactly what
// happened to Brandon's Play install on 2026-05-29: Google sign-in completed,
// Chrome tried to redirect, Android had nothing registered to receive it, and
// the in-app browser session was lost. iOS hits the same wall via
// CFBundleURLTypes; Expo's `ios.config.googleSignIn.reservedClientId` is the
// canonical place to register that.
//
// Reading the client IDs from env at config-resolution time keeps the
// account-specific values out of source and matches how `eas.json`'s build
// profiles already inject them.
const GOOGLE_OAUTH_CLIENT_ID_ANDROID =
  process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID ?? '';
const GOOGLE_OAUTH_CLIENT_ID_IOS =
  process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS ?? '';

function toReversedClientIdScheme(clientId: string): string | null {
  const suffix = '.apps.googleusercontent.com';
  if (!clientId.endsWith(suffix)) return null;
  return `com.googleusercontent.apps.${clientId.slice(0, -suffix.length)}`;
}

const ANDROID_GOOGLE_OAUTH_SCHEME = toReversedClientIdScheme(
  GOOGLE_OAUTH_CLIENT_ID_ANDROID,
);
const IOS_GOOGLE_OAUTH_RESERVED_CLIENT_ID = toReversedClientIdScheme(
  GOOGLE_OAUTH_CLIENT_ID_IOS,
);

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
  version: '0.1.1',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: ANDROID_GOOGLE_OAUTH_SCHEME
    ? ['showbook', ANDROID_GOOGLE_OAUTH_SCHEME]
    : 'showbook',
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
      ...(IOS_GOOGLE_OAUTH_RESERVED_CLIENT_ID
        ? {
            googleSignIn: {
              reservedClientId: IOS_GOOGLE_OAUTH_RESERVED_CLIENT_ID,
            },
          }
        : {}),
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
    package: 'me.ethanasm.showbook',
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
        // Light splash (default). When the asset is replaced with real
        // artwork, the gold-on-black brand mark renders against the
        // bg color below for the brief moment Expo holds the splash.
        image: './assets/splash.png',
        backgroundColor: '#0C0C0C',
        resizeMode: 'cover',
        // Dark-mode variant. Kicks in when userInterfaceStyle resolves
        // to `dark`. Showbook is dark-everywhere so this differs only
        // in the explicit `backgroundColor` hint to native splash —
        // until the real splash-dark.png exists, the file points at
        // the same placeholder.
        dark: {
          image: './assets/splash.png',
          backgroundColor: '#0C0C0C',
          resizeMode: 'cover',
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

export default config;
