/**
 * BrandSplash — the in-app launch splash.
 *
 * On cold launch iOS/Android paint a *native* splash first (the storyboard /
 * drawable generated from the `expo-splash-screen` config in app.config.ts),
 * then hand off to JS once React Native has initialised. The handoff is made
 * seamless per platform:
 *
 * iOS — the storyboard renders the same `splash.png` in an
 * `imageWidth × imageWidth` aspect-fit box, centered; this mirrors that with a
 * `SPLASH_IMAGE_WIDTH × SPLASH_IMAGE_WIDTH` `contain` box reading the SAME
 * shared constant (see lib/splash.ts), so the two are pixel-identical and the
 * native→JS transition is invisible.
 *
 * Android — the 12+ system splash can only render its icon small and
 * circle-masked (no size control), so the native splash carries a transparent
 * image (`splash-blank.png` in app.config.ts) and shows as plain #0C0C0C.
 * This component, sharing that background, is then the FIRST place the mark
 * appears — black → correctly-sized logo, no "small icon → normal icon" pop.
 *
 * The root layout holds this until fonts are ready (see app/_layout.tsx).
 * Using the bundled asset (not a redrawn SVG) is deliberate: it guarantees the
 * JS splash matches what the iOS native splash shows, and the background color
 * matches too, so even the frame before the image decodes is the right color.
 */

import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

import { SPLASH_IMAGE_WIDTH } from '@/lib/splash';

const BG = '#0C0C0C';

// Match the native splash's `imageWidth` (app.config.ts) so the native→JS
// handoff is seamless: same asset, same centered size, same background.
// expo-splash-screen lays the native image into an `imageWidth × imageWidth`
// square box with aspect-fit, so we mirror a square box here — `contain` then
// fits the 1080×1180 asset inside it identically to the storyboard. Both the
// native `imageWidth` and this box read from the same SPLASH_IMAGE_WIDTH
// constant so they can't drift apart (a drift is exactly what caused the
// historical "tiny native icon → normal JS icon" pop).
const LOGO_BOX = SPLASH_IMAGE_WIDTH;

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
