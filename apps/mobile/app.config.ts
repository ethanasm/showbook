import type { ExpoConfig } from 'expo/config';

// Asset files in ./assets are 1x1 PNG placeholders for development. Before
// shipping to TestFlight / App Store / Play Store, replace icon.png with
// 1024x1024, splash.png at proper resolution, and adaptive-icon.png with
// 432x432 foreground per platform guidelines.
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
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'showbook',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'cover',
    backgroundColor: '#0C0C0C',
  },
  ios: {
    bundleIdentifier: 'com.showbook.app',
    supportsTablet: true,
    config: GOOGLE_MAPS_API_KEY
      ? { googleMapsApiKey: GOOGLE_MAPS_API_KEY }
      : undefined,
  },
  android: {
    package: 'com.showbook.app',
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
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
