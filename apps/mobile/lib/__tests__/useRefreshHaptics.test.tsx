/**
 * Unit tests for `useRefreshHaptics`. The hook gates the success haptic
 * on whether the current refresh cycle was started by a user pull, so
 * background refetches (warm-cache mount, polling, focus refetch) don't
 * buzz the phone.
 *
 * Exercised through react-test-renderer with injected haptic stubs so we
 * can assert call counts deterministically without dragging
 * `expo-haptics` (and therefore `react-native`) into the transformer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — bundled type stubs are not installed for react-test-renderer; tests stay JS-typed.
import TestRenderer from 'react-test-renderer';

import {
  useRefreshHaptics,
  type RefreshHaptics,
  type RefreshHapticsDeps,
} from '../useRefreshHaptics';

type Stubs = {
  selection: () => void;
  success: () => void;
  warning: () => void;
  selectionCalls: number;
  successCalls: number;
  warningCalls: number;
};

function makeStubs(): Stubs {
  const s = {
    selectionCalls: 0,
    successCalls: 0,
    warningCalls: 0,
  } as Stubs;
  s.selection = () => {
    s.selectionCalls += 1;
  };
  s.success = () => {
    s.successCalls += 1;
  };
  s.warning = () => {
    s.warningCalls += 1;
  };
  return s;
}

function Harness({
  refreshing,
  onRefresh,
  deps,
  onState,
  onFailure,
}: {
  refreshing: boolean;
  onRefresh: () => void | PromiseLike<unknown>;
  deps: RefreshHapticsDeps;
  onState: (s: RefreshHaptics) => void;
  onFailure?: (err: unknown) => void;
}) {
  const state = useRefreshHaptics(refreshing, onRefresh, deps, onFailure);
  onState(state);
  return null;
}

function renderHarness(
  initialRefreshing: boolean,
  opts: {
    onRefresh?: () => void | PromiseLike<unknown>;
    onFailure?: (err: unknown) => void;
  } = {},
) {
  const stubs = makeStubs();
  let latest!: RefreshHaptics;
  let refreshCalls = 0;
  const impl = opts.onRefresh ?? (() => undefined);
  const wrappedRefresh = () => {
    refreshCalls += 1;
    return impl();
  };
  const onState = (s: RefreshHaptics) => {
    latest = s;
  };
  const deps = {
    selection: stubs.selection,
    success: stubs.success,
    warning: stubs.warning,
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(Harness, {
        refreshing: initialRefreshing,
        onRefresh: wrappedRefresh,
        deps,
        onState,
        onFailure: opts.onFailure,
      }),
    );
  });
  return {
    stubs,
    get: () => latest,
    refreshCallCount: () => refreshCalls,
    update(refreshing: boolean) {
      TestRenderer.act(() => {
        renderer.update(
          React.createElement(Harness, {
            refreshing,
            onRefresh: wrappedRefresh,
            deps,
            onState,
            onFailure: opts.onFailure,
          }),
        );
      });
    },
    unmount() {
      TestRenderer.act(() => {
        renderer.unmount();
      });
    },
  };
}

describe('useRefreshHaptics', () => {
  it('does not fire any haptic on initial mount', () => {
    const h = renderHarness(false);
    assert.equal(h.stubs.selectionCalls, 0);
    assert.equal(h.stubs.successCalls, 0);
    assert.equal(h.get().manualRefreshing, false);
  });

  it('does not fire success haptic on a background refetch (no manual pull)', () => {
    // Simulates the warm-cache scenario: tab mounts, a background refetch
    // flips refreshing true → false without onManualRefresh ever firing.
    const h = renderHarness(false);
    h.update(true);
    // Spinner gate stays off during background refetches — this is the
    // signal the themed RefreshControl uses to skip the native spinner so
    // iOS doesn't get stuck mid-toggle on tab-switch foreground-sync.
    assert.equal(h.get().manualRefreshing, false);
    h.update(false);
    assert.equal(h.stubs.selectionCalls, 0);
    assert.equal(h.stubs.successCalls, 0);
    assert.equal(h.get().manualRefreshing, false);
  });

  it('fires selection haptic on manual pull, success haptic when it completes', () => {
    const h = renderHarness(false);
    TestRenderer.act(() => {
      h.get().onManualRefresh();
    });
    assert.equal(h.stubs.selectionCalls, 1);
    assert.equal(h.refreshCallCount(), 1);
    // Spinner gate flips on with the pull and clears when refreshing settles.
    assert.equal(h.get().manualRefreshing, true);
    // Refresh cycle: refreshing flips true then back to false.
    h.update(true);
    assert.equal(h.get().manualRefreshing, true);
    h.update(false);
    assert.equal(h.stubs.successCalls, 1);
    assert.equal(h.get().manualRefreshing, false);
  });

  it('does not fire success again on a follow-up background refetch', () => {
    const h = renderHarness(false);
    // Manual pull completes successfully.
    TestRenderer.act(() => {
      h.get().onManualRefresh();
    });
    h.update(true);
    h.update(false);
    assert.equal(h.stubs.successCalls, 1);
    // Now a background refetch fires; must NOT buzz.
    h.update(true);
    h.update(false);
    assert.equal(h.stubs.successCalls, 1);
    assert.equal(h.stubs.selectionCalls, 1);
  });

  it('handles a manual pull that lands while a background refetch is mid-flight', () => {
    const h = renderHarness(false);
    // Background refetch starts.
    h.update(true);
    // User pulls down while it is still in flight — selection should fire,
    // and when refreshing eventually flips back to false we still want a
    // success cue because the pull was real.
    TestRenderer.act(() => {
      h.get().onManualRefresh();
    });
    h.update(false);
    assert.equal(h.stubs.selectionCalls, 1);
    assert.equal(h.stubs.successCalls, 1);
  });

  it('onManualRefresh always invokes the supplied onRefresh', () => {
    const h = renderHarness(false);
    TestRenderer.act(() => {
      h.get().onManualRefresh();
      h.get().onManualRefresh();
    });
    assert.equal(h.refreshCallCount(), 2);
    assert.equal(h.stubs.selectionCalls, 2);
  });

  // Promise-driven cycles: every production call site returns its
  // `refetch()` (or `Promise.all([...refetch()])`) resolution, which React
  // Query resolves with `status: 'error'` instead of rejecting. The
  // completion haptic must reflect that outcome — this is the regression
  // guard for "manual refresh does nothing" when the server is down or the
  // session has expired.

  it('fires success (not warning) when a promise-driven refresh resolves clean', async () => {
    const h = renderHarness(false, {
      onRefresh: () => Promise.resolve({ status: 'success', data: [] }),
    });
    await TestRenderer.act(async () => {
      h.get().onManualRefresh();
    });
    assert.equal(h.stubs.selectionCalls, 1);
    assert.equal(h.stubs.successCalls, 1);
    assert.equal(h.stubs.warningCalls, 0);
    // The refreshing flip must not double-fire the success haptic.
    h.update(true);
    h.update(false);
    assert.equal(h.stubs.successCalls, 1);
    assert.equal(h.get().manualRefreshing, false);
  });

  it('fires warning + onFailure when a refetch resolves with status error', async () => {
    const boom = new Error('UNAUTHORIZED');
    const failures: unknown[] = [];
    const h = renderHarness(false, {
      onRefresh: () => Promise.resolve({ status: 'error', error: boom }),
      onFailure: (err) => failures.push(err),
    });
    await TestRenderer.act(async () => {
      h.get().onManualRefresh();
    });
    assert.equal(h.stubs.warningCalls, 1);
    assert.equal(h.stubs.successCalls, 0);
    assert.deepEqual(failures, [boom]);
    // Spinner still resets when the fetch state settles.
    h.update(true);
    h.update(false);
    assert.equal(h.stubs.successCalls, 0);
    assert.equal(h.get().manualRefreshing, false);
  });

  it('finds a failure inside a Promise.all resolution (multi-query screens)', async () => {
    const boom = new Error('fetch failed');
    const failures: unknown[] = [];
    const h = renderHarness(false, {
      onRefresh: () =>
        Promise.all([
          Promise.resolve(undefined), // e.g. utils.X.invalidate()
          Promise.resolve({ status: 'success', data: 1 }),
          Promise.resolve({ status: 'error', error: boom }),
        ]),
      onFailure: (err) => failures.push(err),
    });
    await TestRenderer.act(async () => {
      h.get().onManualRefresh();
    });
    assert.equal(h.stubs.warningCalls, 1);
    assert.equal(h.stubs.successCalls, 0);
    assert.deepEqual(failures, [boom]);
  });

  it('fires warning + onFailure when the refresh promise rejects outright', async () => {
    const boom = new Error('kaboom');
    const failures: unknown[] = [];
    const h = renderHarness(false, {
      onRefresh: () => Promise.reject(boom),
      onFailure: (err) => failures.push(err),
    });
    await TestRenderer.act(async () => {
      h.get().onManualRefresh();
    });
    assert.equal(h.stubs.warningCalls, 1);
    assert.equal(h.stubs.successCalls, 0);
    assert.deepEqual(failures, [boom]);
  });

  it('a pull that settles after unmount fires no haptic and no onFailure', async () => {
    // User pulls, the request retries for a few seconds, user navigates
    // away. The late resolution must not toast/buzz on the next screen.
    let release!: (v: unknown) => void;
    const slow = new Promise((resolve) => {
      release = resolve;
    });
    const failures: unknown[] = [];
    const h = renderHarness(false, {
      onRefresh: () => slow,
      onFailure: (err) => failures.push(err),
    });
    await TestRenderer.act(async () => {
      h.get().onManualRefresh();
    });
    h.unmount();
    await TestRenderer.act(async () => {
      release({ status: 'error', error: new Error('late failure') });
      await slow;
    });
    assert.equal(h.stubs.successCalls, 0);
    assert.equal(h.stubs.warningCalls, 0);
    assert.deepEqual(failures, []);
  });

  it('only the latest of two overlapping pulls fires the completion haptic', async () => {
    let release!: (v: unknown) => void;
    const slow = new Promise((resolve) => {
      release = resolve;
    });
    let call = 0;
    const h = renderHarness(false, {
      onRefresh: () => {
        call += 1;
        return call === 1 ? slow : Promise.resolve({ status: 'success', data: [] });
      },
    });
    await TestRenderer.act(async () => {
      h.get().onManualRefresh(); // slow pull, superseded
      h.get().onManualRefresh(); // fast pull, wins
    });
    assert.equal(h.stubs.successCalls, 1);
    await TestRenderer.act(async () => {
      release({ status: 'success', data: [] });
      await slow;
    });
    // The superseded pull must not fire a second completion haptic.
    assert.equal(h.stubs.successCalls, 1);
    assert.equal(h.stubs.warningCalls, 0);
  });
});
