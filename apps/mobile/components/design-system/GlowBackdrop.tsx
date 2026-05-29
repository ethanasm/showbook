/**
 * GlowBackdrop — absolute-positioned decorative backdrop used behind hero
 * sections and the editorial empty state. Mirrors the web `.glow-backdrop`
 * rule: a vertical surface→bg fade with two soft gold/blue blobs at the
 * top-left and bottom-right.
 *
 * Implementation note: the first cut used `react-native-svg`'s
 * `<Pattern>` / `<Mask>` / `<RadialGradient>` to mirror the web treatment
 * pixel-for-pixel. On iOS that produced two visible bugs in the
 * 2026-05-19 dev client:
 *
 *   1. "Unimplemented component: <ViewManagerAdapter_RNSVGPattern>"
 *      (and same for `Mask`) — those view managers aren't registered
 *      by react-native-svg on iOS, so the SVG layer painted a debug
 *      placeholder over the screen.
 *   2. `<Stop stopOpacity="0" />` was ignored by the RadialGradient,
 *      so the two blobs rendered as solid-coloured squares with no
 *      fade-out. Stacked over the empty-state hero, they merged into
 *      a flat pink wash that drowned the title and body text.
 *
 * The visual is decorative, so the simplest fix is the right one:
 * drop the SVG path entirely and build the wash from
 * `expo-linear-gradient` only (which IS registered in the binary —
 * #250 added the dep and shipped a fresh native build). Two diagonal
 * gradients in opposite corners approximate the corner blobs, and the
 * base surface→bg gradient stays as-is. The grid overlay is dropped
 * with it; reviewers shouldn't fight legibility for a polish flourish.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/lib/theme';

interface GlowBackdropProps {
  /**
   * Kept for API compatibility with the previous SVG-grid version.
   * Currently a no-op — the grid overlay was the source of the iOS
   * "Unimplemented component" error and added little visual value at
   * the empty-state size.
   */
  grid?: boolean;
}

export function GlowBackdrop(_props: GlowBackdropProps = {}): React.JSX.Element {
  const { tokens, mode } = useTheme();
  const { colors } = tokens;

  // Same colour intent as the web treatment: warm gold accent in the
  // top-left, cool blue accent in the bottom-right. Keep alpha low so
  // body text stays legible — the previous build ran at 0.14/0.16 which
  // looked fine in mockups but stacked into a saturated pink in
  // practice. 0.08 reads as a soft tint behind the title.
  const goldEdge = mode === 'dark' ? 'rgba(255,209,102,0.10)' : 'rgba(229,168,0,0.08)';
  const blueEdge = mode === 'dark' ? 'rgba(58,134,255,0.10)' : 'rgba(58,134,255,0.08)';
  const transparent = 'rgba(0,0,0,0)';

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Base vertical fade: surface (top) → bg (bottom). */}
      <LinearGradient
        colors={[colors.surface, colors.bg]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Gold blob, top-left. Diagonal LinearGradient at low alpha
          mimics a soft radial fade without needing SVG. */}
      <LinearGradient
        colors={[goldEdge, transparent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.7 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Blue blob, bottom-right. Mirror of the gold pass. */}
      <LinearGradient
        colors={[transparent, blueEdge]}
        start={{ x: 0.3, y: 0.5 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
});
