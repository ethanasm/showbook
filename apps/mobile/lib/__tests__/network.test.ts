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
  OfflineSyncProvider,
  useNetwork,
  deriveNetworkState,
  __resetReplayInFlightForTest,
  __setNetInfoSourceForTest,
  __setAppStateSourceForTest,
  type AppStateLike,
  type NetInfoLike,
  type NetInfoLikeState,
  type NetworkState,
  type Outbox,
  type PendingWrite,
} from '../network';
import { FeedbackProvider } from '../feedback';

const T0 = 1_000_000_000_000;

function clockOf(...ticks: number[]): () => number {
  let i = 0;
  return () => ticks[Math.min(i++, ticks.length - 1)] ?? T0;
}

describe('deriveNetworkState', () => {
  it('returns previous state when isConnected is unknown (null)', () => {
    const prev: NetworkState = { online: true, lastSeenOnline: new Date(T0), ready: true };
    const next = deriveNetworkState(prev, { isConnected: null });
    assert.equal(next, prev);
  });

  it('treats isInternetReachable=false as offline', () => {
    const prev: NetworkState = { online: true, lastSeenOnline: new Date(T0), ready: true };
    const next = deriveNetworkState(
      prev,
      { isConnected: true, isInternetReachable: false },
      clockOf(T0 + 1_000),
    );
    assert.equal(next.online, false);
    assert.equal(next.lastSeenOnline?.getTime(), T0 + 1_000);
  });

  it('online → offline transition updates lastSeenOnline only at the transition (not on every poll)', () => {
    let state: NetworkState = { online: true, lastSeenOnline: new Date(T0), ready: true };
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

  it('first reading flips `ready` from false to true even when online matches the optimistic default', () => {
    // INITIAL_STATE in the provider is `{ online: true, ready: false }`
    // — without this carve-out, a seed reading of "online" would be a
    // no-op and `ready` would stay false forever, leaving the outbox
    // replay gated indefinitely.
    const prev: NetworkState = { online: true, lastSeenOnline: null, ready: false };
    const next = deriveNetworkState(
      prev,
      { isConnected: true, isInternetReachable: true },
      clockOf(T0),
    );
    assert.equal(next.ready, true);
    assert.equal(next.online, true);
    // lastSeenOnline is preserved (no actual edge crossed).
    assert.equal(next.lastSeenOnline, null);
  });
});

interface FakeSource extends NetInfoLike {
  emit(state: NetInfoLikeState): void;
  unsubscribed: boolean;
  subscribers: number;
  refreshCalls: number;
  /** Override the next refresh result (and what it re-emits via the listener). */
  setNextRefresh(state: NetInfoLikeState): void;
  /** Defer the seed `fetch()` resolution so tests can interleave a live event. */
  resolveFetch?: (state: NetInfoLikeState) => void;
}

interface FakeSourceOptions {
  /** Hold the initial `fetch()` promise so tests can resolve it manually. */
  deferFetch?: boolean;
}

function fakeNetInfo(
  initial: NetInfoLikeState,
  opts: FakeSourceOptions = {},
): FakeSource {
  const handlers = new Set<(s: NetInfoLikeState) => void>();
  let nextRefresh: NetInfoLikeState | null = null;
  const src: FakeSource = {
    unsubscribed: false,
    subscribers: 0,
    refreshCalls: 0,
    addEventListener(cb) {
      handlers.add(cb);
      src.subscribers += 1;
      return () => {
        handlers.delete(cb);
        src.unsubscribed = true;
      };
    },
    fetch() {
      if (opts.deferFetch) {
        return new Promise<NetInfoLikeState>((resolve) => {
          src.resolveFetch = (s) => {
            opts.deferFetch = false;
            src.resolveFetch = undefined;
            resolve(s);
          };
        });
      }
      return Promise.resolve(initial);
    },
    async refresh() {
      src.refreshCalls += 1;
      const next = nextRefresh ?? initial;
      // Mirror real NetInfo: `refresh()` re-emits via the listener.
      for (const h of handlers) h(next);
      return next;
    },
    emit(state) {
      for (const h of handlers) h(state);
    },
    setNextRefresh(state) {
      nextRefresh = state;
    },
  };
  return src;
}

interface FakeAppState extends AppStateLike {
  trigger(state: string): void;
  subscribers: number;
}

function fakeAppState(): FakeAppState {
  const handlers = new Set<(s: string) => void>();
  const src: FakeAppState = {
    subscribers: 0,
    addEventListener(_event, cb) {
      handlers.add(cb);
      src.subscribers += 1;
      return {
        remove: () => {
          handlers.delete(cb);
        },
      };
    },
    trigger(state) {
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
    __setAppStateSourceForTest(null);
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
          { source, offlineRefreshIntervalMs: 0 },
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

  it('seed fetch resolution does not clobber a live event that arrived first', async () => {
    // Regression: on iOS the seed `fetch()` can resolve with a stale
    // "offline" reading after the live listener has already emitted
    // the fresh "online" state. Without guarding, the seed would flip
    // us back to offline and the app would stay pinned.
    const source = fakeNetInfo(
      { isConnected: false, isInternetReachable: false },
      { deferFetch: true },
    );
    const observed: NetworkState[] = [];
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          NetworkProvider,
          { source, now: () => T0, offlineRefreshIntervalMs: 0 },
          React.createElement(StateProbe, { onState: (s) => observed.push(s) }),
        ),
      );
    });
    // Live event lands first with the fresh online reading.
    await TestRenderer.act(async () => {
      source.emit({ isConnected: true, isInternetReachable: true });
    });
    assert.equal(observed[observed.length - 1]!.online, true);
    // Now the stale seed resolves — must NOT flip us back to offline.
    await TestRenderer.act(async () => {
      source.resolveFetch?.({ isConnected: false, isInternetReachable: false });
    });
    assert.equal(
      observed[observed.length - 1]!.online,
      true,
      'live event wins over stale seed',
    );
    renderer.unmount();
  });

  it('foreground transition calls NetInfo.refresh()', async () => {
    const source = fakeNetInfo({ isConnected: false, isInternetReachable: false });
    const appState = fakeAppState();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    const observed: NetworkState[] = [];
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          NetworkProvider,
          { source, appState, now: () => T0, offlineRefreshIntervalMs: 0 },
          React.createElement(StateProbe, { onState: (s) => observed.push(s) }),
        ),
      );
    });
    assert.equal(source.refreshCalls, 0);
    // User toggled airplane mode off while the app was backgrounded;
    // returning to the foreground forces a re-probe.
    source.setNextRefresh({ isConnected: true, isInternetReachable: true });
    await TestRenderer.act(async () => {
      appState.trigger('active');
    });
    assert.equal(source.refreshCalls, 1, 'refresh fired on foreground');
    assert.equal(
      observed[observed.length - 1]!.online,
      true,
      'state flipped online from the refresh re-emission',
    );
    renderer.unmount();
  });

  it('arms a periodic refresh while offline and tears it down when online', async () => {
    // Fake timers via a tight interval — the test only checks that the
    // offline branch eventually calls `refresh()` and the online branch
    // stops calling it.
    const source = fakeNetInfo({ isConnected: false, isInternetReachable: false });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          NetworkProvider,
          { source, now: () => T0, offlineRefreshIntervalMs: 10 },
          React.createElement(StateProbe, { onState: () => undefined }),
        ),
      );
    });
    // Let the interval tick a couple of times.
    await new Promise((r) => setTimeout(r, 35));
    const offlineCalls = source.refreshCalls;
    assert.ok(offlineCalls >= 2, `expected >=2 refresh calls while offline, got ${offlineCalls}`);

    // Flip online via a live event — interval should disarm.
    await TestRenderer.act(async () => {
      source.emit({ isConnected: true, isInternetReachable: true });
    });
    const callsAtFlip = source.refreshCalls;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      source.refreshCalls,
      callsAtFlip,
      'no further refresh calls once online',
    );
    renderer.unmount();
  });
});

// ---------------------------------------------------------------------------
// OfflineSyncProvider mount-time replay
// ---------------------------------------------------------------------------

function fakeOutbox(initial: PendingWrite[] = []): Outbox & {
  drops: string[];
} {
  const rows = new Map<string, PendingWrite>();
  for (const w of initial) rows.set(w.id, w);
  const drops: string[] = [];
  const ob: Outbox & { drops: string[] } = {
    drops,
    async enqueue({ id, mutation, payload }) {
      const write: PendingWrite = {
        id: id ?? `pw-${Math.random().toString(36).slice(2, 8)}`,
        mutation,
        payload,
        createdAt: Date.now(),
        attempts: 0,
        lastError: null,
      };
      rows.set(write.id, write);
      return write;
    },
    async list() {
      return Array.from(rows.values()).sort((a, b) => a.createdAt - b.createdAt);
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async drop(id) {
      drops.push(id);
      rows.delete(id);
    },
    async recordFailure(id, error) {
      const row = rows.get(id);
      if (row) {
        row.attempts += 1;
        row.lastError = error;
      }
    },
    async clear() {
      rows.clear();
    },
  };
  return ob;
}

describe('OfflineSyncProvider replay-on-mount', () => {
  beforeEach(() => {
    __setNetInfoSourceForTest(null);
    __setAppStateSourceForTest(null);
    __resetReplayInFlightForTest();
  });

  it('replays pending writes on cold start when already online (no offline→online transition needed)', async () => {
    // Reproduces the "force-quit while a queued mutation is stuck on
    // `pending: true` in the React Query cache" scenario from the
    // airplane-mode reconnect bug. Before the fix, the effect only ran
    // on a transition edge — and on cold start `wasOnlineRef.current`
    // was already `true` (matching INITIAL_STATE), so replay never
    // fired and the row sat in the outbox forever.
    const source = fakeNetInfo({ isConnected: true, isInternetReachable: true });
    const outbox = fakeOutbox([
      {
        id: 'pw-queued-1',
        mutation: 'spotify.createHypePlaylist',
        payload: { showId: 's-1' },
        createdAt: 1_000,
        attempts: 0,
        lastError: null,
      },
    ]);
    const dispatched: string[] = [];
    const dispatch = async (write: PendingWrite): Promise<void> => {
      dispatched.push(write.id);
    };

    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          FeedbackProvider,
          null,
          React.createElement(
            NetworkProvider,
            { source, offlineRefreshIntervalMs: 0 },
            React.createElement(OfflineSyncProvider, {
              dispatch,
              outbox,
              pollMs: 1_000_000,
              children: null,
            }),
          ),
        ),
      );
    });
    // Let the replay micro-tasks settle.
    await TestRenderer.act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    assert.deepEqual(
      dispatched,
      ['pw-queued-1'],
      'pending write replayed on mount even without an online transition',
    );
    assert.deepEqual(outbox.drops, ['pw-queued-1'], 'row dropped after successful dispatch');
    renderer.unmount();
  });

  it('does not replay on mount when offline', async () => {
    const source = fakeNetInfo({ isConnected: false, isInternetReachable: false });
    const outbox = fakeOutbox([
      {
        id: 'pw-stuck',
        mutation: 'shows.update',
        payload: { showId: 's-1' },
        createdAt: 1_000,
        attempts: 0,
        lastError: null,
      },
    ]);
    let dispatched = 0;
    const dispatch = async (): Promise<void> => {
      dispatched += 1;
    };

    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          FeedbackProvider,
          null,
          React.createElement(
            NetworkProvider,
            { source, offlineRefreshIntervalMs: 0 },
            React.createElement(OfflineSyncProvider, {
              dispatch,
              outbox,
              pollMs: 1_000_000,
              children: null,
            }),
          ),
        ),
      );
    });
    await TestRenderer.act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    assert.equal(dispatched, 0, 'no replay while offline');

    // When the network flips online, the replay should kick off.
    await TestRenderer.act(async () => {
      source.emit({ isConnected: true, isInternetReachable: true });
    });
    await TestRenderer.act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    assert.equal(dispatched, 1, 'replay fires on offline → online transition');
    renderer.unmount();
  });
});
