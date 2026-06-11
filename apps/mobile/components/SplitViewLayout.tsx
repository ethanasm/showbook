/**
 * SplitViewLayout — two-pane list / detail composition for the Shows
 * tab on large screens (iPad, plus-size phones in landscape).
 *
 * Layout: [ list sidebar | detail ] with a 1pt rule divider tinted from
 * the theme's rule token. The sidebar takes ~38% of the window clamped
 * to 340–420pt (`splitSidebarWidth`) — wide enough that ShowCard
 * headliners don't truncate, narrow enough that the detail pane keeps
 * the lion's share of the width at every tablet size.
 *
 * This replaces the earlier iPad three-pane shell (Shows | detail | Map),
 * which squeezed three columns into the window, hid the Home / Add /
 * Discover tabs entirely, and pinned the Map to a 360pt sliver. The
 * standard tab bar now renders on every breakpoint; the Map tab gets
 * the full screen; only the Shows tab composes this split view.
 *
 * Cross-pane selection lives in a small React context exposed via
 * `useSelectedShow()`. The list pane writes a show id when the user
 * taps a row; the detail pane reads it as ShowDetail's `showId` prop.
 * Drag-divider polish and sticky scroll position are deliberately out
 * of scope.
 */

import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useTheme } from '@/lib/theme';
import { splitSidebarWidth } from '@/lib/responsive';

interface SelectedShowContextValue {
  showId: string | null;
  setShowId: (id: string | null) => void;
  /** True when we're rendering inside the tablet split-view layout. */
  isSplitView: boolean;
}

const SelectedShowContext = React.createContext<SelectedShowContextValue | null>(null);

/**
 * Read / write the split-view pane selection. On phone the provider is
 * absent so consumers fall back to a no-op + `isSplitView: false`. List
 * screens branch on `isSplitView` to decide between in-place selection
 * (tablet) and a Stack push (phone).
 */
export function useSelectedShow(): SelectedShowContextValue {
  const ctx = React.useContext(SelectedShowContext);
  if (ctx) return ctx;
  return {
    showId: null,
    setShowId: () => undefined,
    isSplitView: false,
  };
}

interface SplitViewLayoutProps {
  list: React.ReactNode;
  detail: React.ReactNode;
}

export function SplitViewLayout({
  list,
  detail,
}: SplitViewLayoutProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { width } = useWindowDimensions();
  const [showId, setShowId] = React.useState<string | null>(null);

  const value = React.useMemo<SelectedShowContextValue>(
    () => ({ showId, setShowId, isSplitView: true }),
    [showId],
  );

  return (
    <SelectedShowContext.Provider value={value}>
      <View style={[styles.row, { backgroundColor: colors.bg }]}>
        <View
          style={[
            styles.listPane,
            { width: splitSidebarWidth(width), borderRightColor: colors.rule },
          ]}
        >
          {list}
        </View>
        <View style={styles.detailPane}>{detail}</View>
      </View>
    </SelectedShowContext.Provider>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  listPane: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  detailPane: {
    flex: 1,
  },
});
