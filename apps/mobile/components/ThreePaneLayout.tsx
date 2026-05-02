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
 * Each pane is a fixed slot — the children passed in are mounted as-is
 * by (tabs)/_layout.tsx (the existing Shows / ShowDetail / Map screens).
 * No selection state lives here; cross-pane sync, if any, will land in a
 * later milestone alongside per-screen iPad awareness. Pure layout, no
 * imperative work — safe to remount.
 *
 * Drag-divider polish was deliberately skipped per the M6.C scope note.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';

const LEFT_WIDTH = 320;
const RIGHT_WIDTH = 360;

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

  return (
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
