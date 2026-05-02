/**
 * Tests for the offline / network layer.
 *
 * Three angles:
 *   - `deriveNetworkState` — pure reducer that powers `useNetwork`.
 *   - The `NetworkProvider` lifecycle — subscribes on mount, unsubscribes
 *     on unmount, surfaces values via `useNetwork`. Driven through
 *     `react-test-renderer` (no react-native stubs needed because the
 *     provider only renders a Context.Provider).
 *   - The lazy NetInfo source contract — `__setNetInfoSourceForTest`
 *     overrides the default RN binding so the test never resolves
 *     `@react-native-community/netinfo`.
 *
 * Single-flight + replay behaviour are covered by the outbox integration
 * test in `__tests__/cache/outbox.integration.test.ts`.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import React from 'react';
// react-test-renderer ships CJS only; the type declarations are loose so
// we cast the create helper into a known shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer') as {
  act: (cb: () => void | Promise<void>) => Promise<void>;
  create: (
    el: React.ReactElement,
  ) => { unmount(): void; root: { findByType: (t: unknown) => { props: Record<string, unknown> } } };
};

import {
  NetworkProvider,
  useNetwork,
  deriveNetworkState,
  __setNetInfoSourceForTest,
  type NetInfoLike,
  type NetInfoLikeState,
  type NetworkState,
} from '../network';

const T0 = 1_000_000_000_000;

function clockOf(...ticks: number[]): () => number {
  let i = 0;
  return () => ticks[Math.min(i++, ticks.length - 1)] ?? T0;
}

describe('deriveNetworkState', () => {
  it('returns previous state when isConnected is unknown (null)', () => {
    const prev: NetworkState = { online: true, lastSeenOnline: new Date(T0) };
    const next = deriveNetworkState(prev, { isConnected: null });
    assert.equal(next, prev);
  });

  it('treats isInternetReachable=false as offline', () => {
    const prev: NetworkState = { online: true, lastSeenOnline: new Date(T0) };
    const next = deriveNetworkState(
      prev,
      { isConnected: true, isInternetReachable: false },
      clockOf(T0 + 1_000),
    );
    assert.equal(next.online, false);
    assert.equal(next.lastSeenOnline?.getTime(), T0 + 1_000);
  });

  it('online → offline transition updates lastSeenOnline only at the transition (not on every poll)', () => {
    let state: NetworkState = { online: true, lastSeenOnline: new Date(T0) };
    const clock = clockOf(T0 + 100, T0 + 200, T0 + 300, T0 + 400);
    const onlineReading: NetInfoLikeState = {
      isConnected: true,
      isInternetReachable: true,
    };
    // Identical "online" polls return the same state object — no churn.
    const r1 = deriveNetworkState(state, onlineReading, clock);
    assert.equal(r1, state, 'identity-stable across same-state polls');
    state = r1;

    // Transition: online → offline. lastSeenOnline moves at the edge.
    const offlineReading: NetInfoLikeState = { isConnected: false };
    const r2 = deriveNetworkState(state, offlineReading, clock);
    assert.equal(r2.online, false);
    assert.notEqual(r2.lastSeenOnline?.getTime(), state.lastSeenOnline?.getTime());
    state = r2;

    // Subsequent offline polls do NOT bump lastSeenOnline again.
    const offlineLastSeen = state.lastSeenOnline;
    const r3 = deriveNetworkState(state, offlineReading, clock);
    assert.equal(r3, state, 'identity-stable across same-state polls');
    assert.equal(r3.lastSeenOnline, offlineLastSeen);
  });
});

interface FakeSource extends NetInfoLike {
  emit(state: NetInfoLikeState): void;
  unsubscribed: boolean;
  subscribers: number;
}

function fakeNetInfo(initial: NetInfoLikeState): FakeSource {
  const handlers = new Set<(s: NetInfoLikeState) => void>();
  const src: FakeSource = {
    unsubscribed: false,
    subscribers: 0,
    addEventListener(cb) {
      handlers.add(cb);
      src.subscribers += 1;
      return () => {
        handlers.delete(cb);
        src.unsubscribed = true;
      };
    },
    async fetch() {
      return initial;
    },
    emit(state) {
      for (const h of handlers) h(state);
    },
  };
  return src;
}

function StateProbe({
  onState,
}: {
  onState: (s: NetworkState) => void;
}): React.ReactElement | null {
  const state = useNetwork();
  React.useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

describe('NetworkProvider lifecycle', () => {
  beforeEach(() => {
    __setNetInfoSourceForTest(null);
  });

  it('useNetwork returns expected values when NetInfo reports connected', async () => {
    const source = fakeNetInfo({ isConnected: true, isInternetReachable: true });
    const observed: NetworkState[] = [];
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          NetworkProvider,
          { source, now: () => T0 },
          React.createElement(StateProbe, { onState: (s) => observed.push(s) }),
        ),
      );
    });
    // After mount: the seed `fetch()` resolves, which is consistent with
    // the default INITIAL_STATE (online=true) — so no actual transition
    // fires and the rendered probe still reports online: true.
    const last = observed[observed.length - 1]!;
    assert.equal(last.online, true);
    renderer.unmount();
  });

  it('emitted offline reading flips online and stamps lastSeenOnline at the transition', async () => {
    const source = fakeNetInfo({ isConnected: true, isInternetReachable: true });
    const observed: NetworkState[] = [];
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          NetworkProvider,
          { source, now: () => T0 + 9_999 },
          React.createElement(StateProbe, { onState: (s) => observed.push(s) }),
        ),
      );
    });
    await TestRenderer.act(async () => {
      source.emit({ isConnected: false });
    });
    const last = observed[observed.length - 1]!;
    assert.equal(last.online, false);
    assert.equal(last.lastSeenOnline?.getTime(), T0 + 9_999);

    // Re-emitting offline doesn't change the state object identity.
    const beforeIdle = observed.length;
    await TestRenderer.act(async () => {
      source.emit({ isConnected: false });
    });
    // No new state pushed because the reducer returns the previous state.
    assert.equal(observed.length, beforeIdle);
    renderer.unmount();
  });

  it('component unmount cleans up the NetInfo subscription', async () => {
    const source = fakeNetInfo({ isConnected: true, isInternetReachable: true });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          NetworkProvider,
          { source },
          React.createElement(StateProbe, { onState: () => undefined }),
        ),
      );
    });
    assert.equal(source.subscribers, 1, 'subscribed on mount');
    assert.equal(source.unsubscribed, false);
    await TestRenderer.act(async () => {
      renderer.unmount();
    });
    assert.equal(source.unsubscribed, true, 'unsubscribed on unmount');
  });
});
