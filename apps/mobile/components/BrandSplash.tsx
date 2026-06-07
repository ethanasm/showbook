/**
 * BrandSplash — the in-app launch splash, and the ONLY place the brand mark
 * is shown at launch.
 *
 * On cold launch iOS/Android paint a *native* splash first (generated from the
 * `expo-splash-screen` config in app.config.ts), then hand off to JS once React
 * Native has initialised. That native splash is intentionally a plain #0C0C0C
 * screen with **no logo** — a logo there rendered noticeably smaller than this
 * component, producing a "tiny icon → normal icon" pop. So the native splash is
 * blank-black and this component, sharing the same #0C0C0C background, is the
 * first thing the user actually sees: black → correctly-sized mark, no pop.
 * The root layout holds this until fonts are ready (see app/_layout.tsx).
 *
 * Using the bundled `splash.png` asset (not a redrawn SVG) keeps the mark a
 * single source of truth, and the background color matches the native splash
 * so even the frame before the image decodes is the right color.
 */

import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

const BG = '#0C0C0C';

// Match the native splash's `imageWidth` (app.config.ts) so the native→JS
// handoff is seamless: same asset, same centered size, same background.
// expo-splash-screen lays the native image into an `imageWidth × imageWidth`
// square box with aspect-fit, so we mirror a square box here — `contain` then
// fits the 1080×1180 asset inside it identically to the storyboard.
const LOGO_BOX = 200;

export function BrandSplash(): React.JSX.Element {
  return (
    <View style={styles.root}>
      <Image
        // Same asset the native splash is generated from, rendered at the same
        // centered size — keeps the native→JS handoff seamless.
        source={require('../assets/splash.png')}
        resizeMode="contain"
        style={styles.image}
        accessibilityLabel="Showbook"
      />
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
  image: {
    width: LOGO_BOX,
    height: LOGO_BOX,
  },
});

export default BrandSplash;
