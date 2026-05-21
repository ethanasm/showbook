/**
 * Pure haptic-gating hook for pull-to-refresh.
 *
 * The previous implementation fired a success haptic on every
 * `refreshing: true → false` transition. That includes background
 * refetches (warm-cache mount, `refetchOnWindowFocus`, polling, etc.)
 * where the user never pulled — which produced an annoying buzz the
 * first time you opened each tab.
 *
 * This hook gates haptics on whether the current refresh cycle was
 * actually started by a manual pull. The flag is set inside
 * `onManualRefresh` and consumed when refreshing flips back to false.
 *
 * The same flag is also exposed as `manualRefreshing` so the themed
 * RefreshControl can gate the *spinner* on user-initiated cycles. iOS
 * `RefreshControl` gets stuck visible when its `refreshing` prop is
 * toggled rapidly by background refetches (the foreground-sync hop
 * fires `invalidateQueries({ type: 'active' })` on every app resume,
 * which flips `isFetching` true → false on every active query). Gating
 * on `manualRefreshing` keeps the spinner invisible for those.
 *
 * Lives in `lib/` (not next to `PullToRefresh.tsx`) so it lands inside
 * the mobile coverage gate and stays unit-testable. The default haptic
 * deps are pulled in via require() rather than a top-level import so
 * Node-only tests don't transitively load `react-native` / `expo-haptics`
 * (mirroring the same dance in `./responsive.ts`).
 */

import React from 'react';

export interface RefreshHaptics {
  /** Wrap the consumer's onRefresh; fires the selection haptic + marks the cycle as manual. */
  onManualRefresh: () => void;
  /**
   * True while a user-initiated refresh cycle is in progress. Resets when
   * `refreshing` flips back to false. Consumers (the themed RefreshControl)
   * use this to gate the spinner so background refetches don't flash it.
   */
  manualRefreshing: boolean;
}

export interface RefreshHapticsDeps {
  selection: () => Promise<void> | void;
  success: () => Promise<void> | void;
}

interface HapticsModule {
  hapticSelection: () => Promise<void>;
  hapticSuccess: () => Promise<void>;
}

let _haptics: HapticsModule | null = null;
let _hapticsTried = false;
function loadHaptics(): HapticsModule | null {
  if (_hapticsTried) return _haptics;
  _hapticsTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _haptics = require('./haptics') as HapticsModule;
  } catch {
    _haptics = null;
  }
  return _haptics;
}

function defaultDeps(): RefreshHapticsDeps {
  const mod = loadHaptics();
  return {
    selection: mod ? mod.hapticSelection : () => undefined,
    success: mod ? mod.hapticSuccess : () => undefined,
  };
}

export function useRefreshHaptics(
  refreshing: boolean,
  onRefresh: () => void,
  // Injectable for tests; production code resolves to the real haptics
  // via the lazy require above.
  deps?: RefreshHapticsDeps,
): RefreshHaptics {
  const resolvedDeps = deps ?? defaultDeps();
  const [manualRefreshing, setManualRefreshing] = React.useState(false);
  const prevRefreshing = React.useRef(refreshing);

  React.useEffect(() => {
    if (prevRefreshing.current && !refreshing) {
      if (manualRefreshing) {
        void resolvedDeps.success();
        setManualRefreshing(false);
      }
    }
    prevRefreshing.current = refreshing;
  }, [refreshing, resolvedDeps, manualRefreshing]);

  const onManualRefresh = React.useCallback(() => {
    setManualRefreshing(true);
    void resolvedDeps.selection();
    onRefresh();
  }, [onRefresh, resolvedDeps]);

  return { onManualRefresh, manualRefreshing };
}
