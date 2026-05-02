/**
 * Three-pane composition for the iPad landscape shell (M6.C).
 *
 * Layout: [ Left | Middle | Right ] in a row, with 1pt rule dividers
 * tinted from the theme's rule token. Left and right are fixed-width
 * sidebars (320 / 360pt) and the middle stretches to fill — those widths
 * keep ShowCard chrome and the Map preview legible at the iPad-portrait
 * minimum (768pt → middle stays >= 88pt; iPad-landscape (~1180pt) gives
 * ~500pt of breathing room).
 *
 * Cross-pane selection lives in a small React context exposed via
 * `useSelectedShow()`. The Shows pane writes a show id when the user
 * taps a row; the ShowDetail pane reads it as its `showId` prop, and
 * the Map pane focuses the matching venue. This is the minimum viable
 * plumbing — drag-divider polish and sticky scroll position are
 * deliberately out of scope.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';

const LEFT_WIDTH = 320;
const RIGHT_WIDTH = 360;

interface SelectedShowContextValue {
  showId: string | null;
  setShowId: (id: string | null) => void;
  /** True when we're rendering inside the iPad three-pane layout. */
  isThreePane: boolean;
}

const SelectedShowContext = React.createContext<SelectedShowContextValue | null>(null);

/**
 * Read / write the iPad pane selection. On phone the provider is absent
 * so consumers fall back to a no-op + `isThreePane: false`. List screens
 * branch on `isThreePane` to decide between in-place selection (iPad)
 * and a Stack push (phone).
 */
export function useSelectedShow(): SelectedShowContextValue {
  const ctx = React.useContext(SelectedShowContext);
  if (ctx) return ctx;
  return {
    showId: null,
    setShowId: () => undefined,
    isThreePane: false,
  };
}

interface ThreePaneLayoutProps {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
}

export function ThreePaneLayout({
  left,
  middle,
  right,
}: ThreePaneLayoutProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const [showId, setShowId] = React.useState<string | null>(null);

  const value = React.useMemo<SelectedShowContextValue>(
    () => ({ showId, setShowId, isThreePane: true }),
    [showId],
  );

  return (
    <SelectedShowContext.Provider value={value}>
      <View style={[styles.row, { backgroundColor: colors.bg }]}>
        <View
          style={[
            styles.leftPane,
            { width: LEFT_WIDTH, borderRightColor: colors.rule },
          ]}
        >
          {left}
        </View>
        <View style={styles.middlePane}>{middle}</View>
        <View
          style={[
            styles.rightPane,
            { width: RIGHT_WIDTH, borderLeftColor: colors.rule },
          ]}
        >
          {right}
        </View>
      </View>
    </SelectedShowContext.Provider>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  leftPane: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  middlePane: {
    flex: 1,
  },
  rightPane: {
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
});
