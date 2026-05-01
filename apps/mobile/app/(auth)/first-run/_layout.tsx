/**
 * Stack layout for the first-run permission sequence.
 * No header, no swipe-back — these screens are gated by the auth flow and
 * users should advance via the explicit Continue / Skip buttons.
 */

import { Stack } from 'expo-router';

export default function FirstRunLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        animation: 'slide_from_right',
      }}
    />
  );
}
