/**
 * Font loader.
 *
 * Loads Fraunces 700 (bold) under the family name 'Fraunces' so the type
 * ramp's `fontFamily: 'Fraunces'` + `fontWeight: '700'` style (heroTitle,
 * headliner) renders with the real face on both iOS and Android. We only
 * ship the bold cut because that's the only weight referenced by the type
 * ramp; ship more weights when the ramp grows.
 *
 * Geist Sans is still a no-op — RN falls back to the system sans on iOS
 * (San Francisco; close enough) and the platform default on Android. The
 * Geist polish pass is tracked in TASKS.md "M1 known issues".
 */

import * as Font from 'expo-font';
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces/700Bold';

export async function loadAppFonts(): Promise<void> {
  await Font.loadAsync({
    Fraunces: Fraunces_700Bold,
  });
}
