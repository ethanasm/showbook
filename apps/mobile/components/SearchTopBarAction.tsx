/**
 * SearchTopBarAction — top-right magnifier that opens the global
 * omnisearch modal (`/search`).
 *
 * Lives in the right-action slot of every main tab header (Home, Shows,
 * Map, Discover) so global search is one tap away no matter where the
 * user is — the same affordance the Discover tab shipped first, now
 * promoted to a shared component so the other tabs reach parity.
 *
 * Maestro / Playwright selectors match on `testID` (default
 * `search-button`); the Discover header passes `discover-search-button`
 * so its pre-existing selector keeps working.
 */

import React from 'react';
import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';

export function SearchTopBarAction({
  testID = 'search-button',
}: {
  testID?: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/search')}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Search"
      testID={testID}
    >
      <Search size={20} color={tokens.colors.ink} strokeWidth={2} />
    </Pressable>
  );
}
