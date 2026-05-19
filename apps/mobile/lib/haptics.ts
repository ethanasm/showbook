/**
 * Haptic feedback helpers.
 *
 * Three perceptual cues wrapping `expo-haptics`. The web shim
 * (`web-shims/expo-haptics.js`) resolves to no-ops on the Playwright
 * web bundle, but we still gate on `Platform.OS` to skip the
 * async-await round-trip on non-native targets.
 *
 * Lives in its own module (rather than alongside the visual feedback
 * system in `./feedback.ts`) so that lib-layer modules consumed by
 * unit tests don't have to pay the cost of pulling `react-native` +
 * `expo-haptics` into the tsx/esbuild transformer. Tests that need
 * to assert haptic behaviour can `mock.module('../haptics', ...)`.
 *
 * Usage:
 *   import { hapticSuccess } from '@/lib/haptics';
 *   await hapticSuccess();   // fire-and-forget; never throws
 */

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

function isHapticPlatform(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/** Confirmation after a successful mutation. iOS: notification-success pattern. */
export async function hapticSuccess(): Promise<void> {
  if (!isHapticPlatform()) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // haptics are best-effort
  }
}

/** Soft warning. Used for non-fatal mutation errors + destructive-action confirm. */
export async function hapticWarning(): Promise<void> {
  if (!isHapticPlatform()) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    // best-effort
  }
}

/** Light selection click. Used for tab switches + chip flips. */
export async function hapticSelection(): Promise<void> {
  if (!isHapticPlatform()) return;
  try {
    await Haptics.selectionAsync();
  } catch {
    // best-effort
  }
}

/**
 * Medium impact "thump". Matches the iOS-native context-menu reveal feel
 * for long-press → action-sheet flows. Stronger than `hapticSelection` so
 * the user actually notices the menu has popped.
 */
export async function hapticImpactMedium(): Promise<void> {
  if (!isHapticPlatform()) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // best-effort
  }
}
