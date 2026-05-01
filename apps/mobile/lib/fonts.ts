/**
 * Font loader.
 *
 * The theme tokens reference 'Geist Sans' and 'Georgia' as fontFamily values.
 * For M1 we ship without bundled Geist assets — React Native falls back to
 * the system sans-serif on iOS (San Francisco; close enough for headers and
 * body text) and the system default on Android. Georgia ships natively on
 * iOS and renders as Roboto's serif fallback on Android.
 *
 * Adding @expo-google-fonts/geist before TestFlight is on the polish backlog;
 * see TASKS.md "M1 known issues". Until then this loader is a no-op so the
 * app boots immediately without an extra network/file-system round trip.
 */

export async function loadAppFonts(): Promise<void> {
  // No-op: rely on system font fallbacks. To enable Geist later:
  //   import * as Font from 'expo-font';
  //   await Font.loadAsync({
  //     'Geist Sans': require('../assets/fonts/Geist-Regular.ttf'),
  //     'Geist Sans-Bold': require('../assets/fonts/Geist-Bold.ttf'),
  //   });
  return;
}
