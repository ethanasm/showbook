/**
 * MeTopBarAction — top-right user-icon affordance that pushes to /me.
 *
 * Used on the top-level tab screens (Home, Shows, Map, Discover) so the
 * Me/Settings screen stays reachable now that it has been moved out of
 * the bottom tab bar. Maestro flows look up the button by testID
 * `me-button`; the accessibilityLabel is also `Me` so the visible-text
 * matcher in older flow YAML keeps working.
 */

import React from 'react';
import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { User } from 'lucide-react-native';
import { useTheme } from '../lib/theme';

export function MeTopBarAction(): React.JSX.Element {
  const { tokens } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/me')}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Me"
      testID="me-button"
    >
      <User size={20} color={tokens.colors.ink} strokeWidth={2} />
    </Pressable>
  );
}
