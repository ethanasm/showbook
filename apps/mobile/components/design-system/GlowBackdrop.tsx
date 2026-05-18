/**
 * GlowBackdrop — absolute-positioned decorative backdrop used behind hero
 * sections and the editorial empty state. Mirrors the web `.glow-backdrop`
 * rule: a vertical surface→bg fade with two soft gold/blue blobs at the
 * top-left and bottom-right, and a faint grid overlay masked to a centre
 * ellipse so it fades at the edges.
 *
 * React Native can't render true CSS radial gradients, so we approximate
 * the blobs with circular `LinearGradient`s (centre → transparent) inside
 * overflow-hidden parents. The result is visually close: a gold wash in
 * one corner and a blue wash in the opposite corner.
 */

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Pattern, Rect, RadialGradient, Stop, Mask } from 'react-native-svg';
import { useTheme } from '../../lib/theme';

interface GlowBackdropProps {
  /** When true, overlay the 48px grid pattern. Default true. */
  grid?: boolean;
}

export function GlowBackdrop({ grid = true }: GlowBackdropProps): React.JSX.Element {
  const { tokens, mode } = useTheme();
  const { colors } = tokens;

  // Pull the rule color into a hex-ish form the SVG can use. The token
  // is already an rgba string in DARK_COLORS / LIGHT_COLORS, so we can
  // just hand it to SVG which accepts it directly.
  const ruleColor = colors.rule;

  // Approximate the gold + blue blobs. Web uses
  //   radial-gradient(1200x600 at 20% 10%, rgba(255,209,102,0.10), transparent 60%)
  //   radial-gradient(900x500 at 80% 90%, rgba(58,134,255,0.10), transparent 60%)
  // We render the same colours at lower opacity to keep the effect subtle.
  const goldRgba = mode === 'dark' ? 'rgba(255,209,102,0.16)' : 'rgba(229,168,0,0.14)';
  const blueRgba = mode === 'dark' ? 'rgba(58,134,255,0.14)' : 'rgba(58,134,255,0.12)';

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Base vertical fade: surface (top) → bg (bottom). */}
      <LinearGradient
        colors={[colors.surface, colors.bg]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Gold blob, top-left. */}
      <View style={[styles.blob, styles.blobTopLeft]} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="goldBlob" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor={goldRgba} stopOpacity="1" />
              <Stop offset="60%" stopColor={goldRgba} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#goldBlob)" />
        </Svg>
      </View>

      {/* Blue blob, bottom-right. */}
      <View style={[styles.blob, styles.blobBottomRight]} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="blueBlob" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor={blueRgba} stopOpacity="1" />
              <Stop offset="60%" stopColor={blueRgba} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#blueBlob)" />
        </Svg>
      </View>

      {/* 48px grid overlay masked to a centre ellipse — only render on
          native. Web has flaky SVG mask support on some browsers, and the
          grid is a "polish" element rather than a functional one. */}
      {grid && Platform.OS !== 'web' ? (
        <Svg
          style={StyleSheet.absoluteFillObject}
          // The SVG box is fluid because we're inside an absolute View.
          // Use preserveAspectRatio="none" so the pattern tiles cleanly.
          preserveAspectRatio="none"
        >
          <Defs>
            <Pattern id="grid48" x="0" y="0" width="48" height="48" patternUnits="userSpaceOnUse">
              <Rect x="0" y="0" width="48" height="48" fill="transparent" />
              <Rect x="0" y="0" width="48" height="1" fill={ruleColor} />
              <Rect x="0" y="0" width="1" height="48" fill={ruleColor} />
            </Pattern>
            <RadialGradient id="gridMask" cx="50%" cy="40%" rx="50%" ry="50%">
              <Stop offset="30%" stopColor="white" stopOpacity="1" />
              <Stop offset="75%" stopColor="white" stopOpacity="0" />
            </RadialGradient>
            <Mask id="gridMaskClip" maskUnits="userSpaceOnUse">
              <Rect width="100%" height="100%" fill="url(#gridMask)" />
            </Mask>
          </Defs>
          <Rect
            width="100%"
            height="100%"
            fill="url(#grid48)"
            mask="url(#gridMaskClip)"
            opacity={0.35}
          />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    width: '120%',
    height: '70%',
  },
  blobTopLeft: {
    top: '-25%',
    left: '-25%',
  },
  blobBottomRight: {
    bottom: '-25%',
    right: '-25%',
  },
});
