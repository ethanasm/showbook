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
 * Failure surfacing: when `onRefresh` returns a promise (every call
 * site returns its `refetch()` / `Promise.all([...refetch()])` result),
 * the hook inspects the resolution with `firstRefetchError` — React
 * Query's `refetch()` resolves with `status: 'error'` instead of
 * rejecting — and on failure fires the *warning* haptic and the
 * `onFailure` callback instead of pretending the pull succeeded. This
 * is what makes "server down / session expired" visible to the user
 * (both were silent no-ops before; see `lib/refresh-failure.ts`).
 * A sync `onRefresh` keeps the legacy behaviour: success haptic when
 * `refreshing` flips back to false.
 *
 * Lives in `lib/` (not next to `PullToRefresh.tsx`) so it lands inside
 * the mobile coverage gate and stays unit-testable. The default haptic
 * deps are pulled in via require() rather than a top-level import so
 * Node-only tests don't transitively load `react-native` / `expo-haptics`
 * (mirroring the same dance in `./responsive.ts`).
 */

import React from 'react';

import { firstRefetchError } from './refresh-failure';

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
  warning: () => Promise<void> | void;
}

interface HapticsModule {
  hapticSelection: () => Promise<void>;
  hapticSuccess: () => Promise<void>;
  hapticWarning: () => Promise<void>;
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

let _defaultDeps: RefreshHapticsDeps | null = null;
function defaultDeps(): RefreshHapticsDeps {
  if (_defaultDeps) return _defaultDeps;
  const mod = loadHaptics();
  _defaultDeps = {
    selection: mod ? mod.hapticSelection : () => undefined,
    success: mod ? mod.hapticSuccess : () => undefined,
    warning: mod ? mod.hapticWarning : () => undefined,
  };
  return _defaultDeps;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export function useRefreshHaptics(
  refreshing: boolean,
  onRefresh: () => void | PromiseLike<unknown>,
  // Injectable for tests; production code resolves to the real haptics
  // via the lazy require above.
  deps?: RefreshHapticsDeps,
  /** Called with the failing query's error when a manual refresh cycle fails. */
  onFailure?: (err: unknown) => void,
): RefreshHaptics {
  const resolvedDeps = deps ?? defaultDeps();
  const [manualRefreshing, setManualRefreshing] = React.useState(false);
  const prevRefreshing = React.useRef(refreshing);
  // When the current manual cycle is promise-driven, the completion haptic
  // fires from the promise resolution (where the outcome is known), not
  // from the refreshing flip — otherwise a failed pull would still buzz
  // success from the effect below.
  const promiseDriven = React.useRef(false);
  // Monotonic pull counter so an older in-flight pull can't fire haptics
  // after a newer pull superseded it (double-pull while slow).
  const cycleId = React.useRef(0);
  const onFailureRef = React.useRef(onFailure);
  onFailureRef.current = onFailure;

  // Invalidate any in-flight cycle on unmount: a slow pull (retries can
  // take a few seconds) must not buzz or toast on whatever screen the
  // user navigated to after leaving this one.
  React.useEffect(
    () => () => {
      cycleId.current += 1;
    },
    [],
  );

  React.useEffect(() => {
    if (prevRefreshing.current && !refreshing) {
      if (manualRefreshing) {
        if (!promiseDriven.current) {
          void resolvedDeps.success();
        }
        setManualRefreshing(false);
      }
    }
    prevRefreshing.current = refreshing;
  }, [refreshing, resolvedDeps, manualRefreshing]);

  const onManualRefresh = React.useCallback(() => {
    setManualRefreshing(true);
    void resolvedDeps.selection();
    const result = onRefresh();
    if (!isThenable(result)) {
      promiseDriven.current = false;
      return;
    }
    promiseDriven.current = true;
    cycleId.current += 1;
    const id = cycleId.current;
    result.then(
      (resolution) => {
        if (id !== cycleId.current) return;
        const err = firstRefetchError(resolution);
        if (err !== undefined) {
          void resolvedDeps.warning();
          onFailureRef.current?.(err);
        } else {
          void resolvedDeps.success();
        }
      },
      (err: unknown) => {
        if (id !== cycleId.current) return;
        void resolvedDeps.warning();
        onFailureRef.current?.(err);
      },
    );
  }, [onRefresh, resolvedDeps]);

  return { onManualRefresh, manualRefreshing };
}
