import type { ExpoConfig } from 'expo/config';

// Asset files in ./assets are 1x1 PNG placeholders for development. Before
// shipping to TestFlight / App Store / Play Store, replace icon.png with
// 1024x1024, splash.png at proper resolution, and adaptive-icon.png with
// 432x432 foreground per platform guidelines.

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
  },
  android: {
    package: 'com.showbook.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0C0C0C',
    },
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
