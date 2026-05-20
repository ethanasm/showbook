/**
 * PullToRefresh — small wrapper that wires `RefreshControl` into a
 * scrollable child while honoring the active theme tint colors.
 *
 * Usage:
 *   <PullToRefresh refreshing={isFetching} onRefresh={refetch}>
 *     <ScrollView>...</ScrollView>
 *   </PullToRefresh>
 *
 * For FlatList / SectionList, prefer passing the RefreshControl directly
 * via the list's `refreshControl` prop using `useThemedRefreshControl()`.
 *
 * Haptic gating (selection on pull-start, success on completion) lives
 * in `lib/useRefreshHaptics.ts` so it stays unit-tested.
 */

import React from 'react';
import {
  RefreshControl,
  type RefreshControlProps,
  type ScrollView,
  type ScrollViewProps,
} from 'react-native';
import { useTheme } from '../lib/theme';
import { useRefreshHaptics } from '../lib/useRefreshHaptics';

export interface PullToRefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  children: React.ReactElement<ScrollViewProps>;
}

/**
 * Build a themed RefreshControl element for use with FlatList / SectionList /
 * ScrollView's `refreshControl` prop.
 */
export function useThemedRefreshControl(
  refreshing: boolean,
  onRefresh: () => void,
): React.ReactElement<RefreshControlProps> {
  const { tokens } = useTheme();
  const { onManualRefresh } = useRefreshHaptics(refreshing, onRefresh);
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onManualRefresh}
      tintColor={tokens.colors.accent}
      colors={[tokens.colors.accent]}
      progressBackgroundColor={tokens.colors.surface}
    />
  );
}

/**
 * Wrap a single ScrollView child and inject a themed RefreshControl.
 * For FlatList/SectionList, use `useThemedRefreshControl()` directly.
 */
export function PullToRefresh({
  refreshing,
  onRefresh,
  children,
}: PullToRefreshProps): React.JSX.Element {
  const refreshControl = useThemedRefreshControl(refreshing, onRefresh);
  // Clone the child to inject the refreshControl prop. The child must be
  // a ScrollView (or compatible component that accepts refreshControl).
  return React.cloneElement(children as React.ReactElement<ScrollViewProps & React.RefAttributes<ScrollView>>, {
    refreshControl,
  });
}
