/**
 * BrandSplash — the in-app launch splash.
 *
 * The native splash (expo-splash-screen, configured in app.config.ts) can
 * only do so much: on Android 12+ the system splash is a small, circle-masked
 * centered icon — a wide "showbook" wordmark can't render there at a readable
 * size no matter how the asset is framed. So we keep the native splash on
 * screen for the shortest possible window (just until JS mounts) and hand off
 * to this full-screen React splash, which we fully control and which renders a
 * large, legible logo + wordmark + tagline on both platforms.
 *
 * Colors are hard-coded to the dark brand palette (DARK_COLORS) rather than
 * pulled from the theme so this can render *outside* ThemeProvider, before the
 * provider tree (and custom fonts) are ready. The mark is drawn inline with
 * react-native-svg using the same ticket path as `BrandMark`, sized large.
 * Text uses the system bold sans so it looks right even before Geist loads.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';

const BG = '#0C0C0C';
const ACCENT = '#FFD166';
const INK = '#F5F5F3';
const MUTED = 'rgba(245,245,243,0.55)';
const S_INK = '#0B0B0A';

const TICKET_PATH =
  'M 14.5 18 H 49.5 A 3.5 3.5 0 0 1 53 21.5 V 30 A 3.75 3.75 0 0 0 49.25 33.75 A 3.75 3.75 0 0 0 53 37.5 V 42.5 A 3.5 3.5 0 0 1 49.5 46 H 14.5 A 3.5 3.5 0 0 1 11 42.5 V 37.5 A 3.75 3.75 0 0 0 14.75 33.75 A 3.75 3.75 0 0 0 11 30 V 21.5 A 3.5 3.5 0 0 1 14.5 18 Z';

export interface BrandSplashProps {
  /** Mark size in px. Default 132 — large enough to read the punch-through S. */
  markSize?: number;
}

export function BrandSplash({ markSize = 132 }: BrandSplashProps): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Svg width={markSize} height={markSize} viewBox="0 0 64 64" accessibilityLabel="Showbook">
          <G originX={32} originY={32} rotation={-6}>
            <Path fill={ACCENT} fillRule="evenodd" d={TICKET_PATH} />
            <SvgText
              x={32}
              y={41.5}
              fontSize={26}
              fontWeight="900"
              fill={S_INK}
              textAnchor="middle"
              fontFamily="System"
            >
              S
            </SvgText>
          </G>
        </Svg>
        <Text style={styles.wordmark}>showbook</Text>
        <Text style={styles.tagline}>YOUR SHOWS, IN ORDER</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    gap: 20,
  },
  wordmark: {
    color: INK,
    fontSize: 46,
    fontWeight: '800',
    letterSpacing: -1,
    marginTop: 4,
  },
  tagline: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 3.5,
  },
});

export default BrandSplash;
