// Web shim for expo-haptics — no-op on the headless Playwright web
// bundle. Native iOS/Android pulls the real module via the normal
// resolver (the swap is gated on `platform === 'web'` in metro.config.js).

export const ImpactFeedbackStyle = Object.freeze({
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
  Soft: 'soft',
  Rigid: 'rigid',
});

export const NotificationFeedbackType = Object.freeze({
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
});

export async function impactAsync() {
  return undefined;
}

export async function notificationAsync() {
  return undefined;
}

export async function selectionAsync() {
  return undefined;
}

export default {
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  impactAsync,
  notificationAsync,
  selectionAsync,
};
