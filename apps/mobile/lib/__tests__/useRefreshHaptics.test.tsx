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
  selectionCalls: number;
  successCalls: number;
};

function makeStubs(): Stubs {
  const s = {
    selectionCalls: 0,
    successCalls: 0,
  } as Stubs;
  s.selection = () => {
    s.selectionCalls += 1;
  };
  s.success = () => {
    s.successCalls += 1;
  };
  return s;
}

function Harness({
  refreshing,
  onRefresh,
  deps,
  onState,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  deps: RefreshHapticsDeps;
  onState: (s: RefreshHaptics) => void;
}) {
  const state = useRefreshHaptics(refreshing, onRefresh, deps);
  onState(state);
  return null;
}

function renderHarness(initialRefreshing: boolean) {
  const stubs = makeStubs();
  let latest!: RefreshHaptics;
  let refreshCalls = 0;
  const onRefresh = () => {
    refreshCalls += 1;
  };
  const onState = (s: RefreshHaptics) => {
    latest = s;
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(Harness, {
        refreshing: initialRefreshing,
        onRefresh,
        deps: { selection: stubs.selection, success: stubs.success },
        onState,
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
            onRefresh,
            deps: { selection: stubs.selection, success: stubs.success },
            onState,
          }),
        );
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
});
