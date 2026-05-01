import type { ExpoConfig } from 'expo/config';

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
