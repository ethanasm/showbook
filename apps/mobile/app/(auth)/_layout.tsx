/**
 * Stack layout for the unauthenticated routes (sign-in + first-run).
 * No header — every screen owns its own chrome.
 */

import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
