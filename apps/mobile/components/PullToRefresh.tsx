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
 * via the list's `refreshControl` prop using `buildRefreshControl()`.
 */

import React from 'react';
import {
  RefreshControl,
  type RefreshControlProps,
  type ScrollView,
  type ScrollViewProps,
} from 'react-native';
import { useTheme } from '../lib/theme';
import { hapticSelection, hapticSuccess } from '../lib/haptics';

export interface PullToRefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  children: React.ReactElement<ScrollViewProps>;
}

/**
 * Build a themed RefreshControl element for use with FlatList / SectionList /
 * ScrollView's `refreshControl` prop. Fires a selection haptic on pull-start
 * and a success haptic when the refresh finishes.
 */
export function useThemedRefreshControl(
  refreshing: boolean,
  onRefresh: () => void,
): React.ReactElement<RefreshControlProps> {
  const { tokens } = useTheme();
  const prevRefreshing = React.useRef(refreshing);
  React.useEffect(() => {
    if (prevRefreshing.current && !refreshing) {
      // Transition from refreshing → done: fire the success cue.
      void hapticSuccess();
    }
    prevRefreshing.current = refreshing;
  }, [refreshing]);
  const handleRefresh = React.useCallback(() => {
    void hapticSelection();
    onRefresh();
  }, [onRefresh]);
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
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
