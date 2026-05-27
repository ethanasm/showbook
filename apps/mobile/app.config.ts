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

const config: ExpoConfig = {
  name: 'Showbook',
  slug: 'showbook',
  owner: 'ethanasm',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'showbook',
  userInterfaceStyle: 'automatic',
  // The legacy `splash` block stays as the iOS fallback for SDKs that
  // haven't migrated to the plugin yet. The expo-splash-screen plugin
  // below is the canonical wiring on SDK 55 and supports the dark
  // variant the design calls for.
  splash: {
    image: './assets/splash.png',
    resizeMode: 'cover',
    backgroundColor: '#0C0C0C',
  },
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
