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
  const manualRef = React.useRef(false);
  const prevRefreshing = React.useRef(refreshing);

  React.useEffect(() => {
    if (prevRefreshing.current && !refreshing) {
      if (manualRef.current) {
        void resolvedDeps.success();
      }
      manualRef.current = false;
    }
    prevRefreshing.current = refreshing;
  }, [refreshing, resolvedDeps]);

  const onManualRefresh = React.useCallback(() => {
    manualRef.current = true;
    void resolvedDeps.selection();
    onRefresh();
  }, [onRefresh, resolvedDeps]);

  return { onManualRefresh };
}
