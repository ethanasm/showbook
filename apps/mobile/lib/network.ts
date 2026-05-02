/**
 * Online/offline detection + pending-writes replay.
 *
 * Pieces:
 *   - `useNetwork()` — returns `{ online, lastSeenOnline }`. Backed by a
 *     `@react-native-community/netinfo` subscription owned by
 *     `NetworkProvider`.
 *   - `NetworkProvider` — subscribes once, derives state via
 *     `deriveNetworkState`, and re-renders consumers on transitions only.
 *   - `getOutbox()` — opens (and caches) a SQLite-backed `Outbox` against
 *     the shared cache db. The drawer + replay machinery share this
 *     instance.
 *   - `replayOutbox(opts)` — pure async function that walks pending writes
 *     in FIFO order and fires `dispatch(write)` for each. 4xx responses
 *     leave the row with `last_error` set; transient (5xx / network)
 *     errors retry with backoff up to `maxAttempts`. Successful rows are
 *     dropped from the outbox.
 *   - `replayOutboxOnce(opts)` — single-flight wrapper. Concurrent calls
 *     return the same in-flight promise so a flapping reconnect doesn't
 *     double-fire a queued write.
 *
 * The NetInfo binding is loaded lazily so node:test runs (and the unit
 * tests below) don't try to resolve the native module. Tests inject
 * stand-ins via `__setNetInfoSourceForTest` and `__setOutboxOpenerForTest`.
 */

import React from 'react';
import {
  type Outbox,
  type PendingWrite,
} from './cache/outbox';
import { getCacheOutbox } from './cache/db';
import { useFeedback } from './feedback';

// ---------------------------------------------------------------------------
// NetInfo abstraction
// ---------------------------------------------------------------------------

export interface NetInfoLikeState {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
}

export interface NetInfoLike {
  addEventListener(cb: (state: NetInfoLikeState) => void): () => void;
  fetch(): Promise<NetInfoLikeState>;
}

let _netInfoSource: NetInfoLike | null = null;

function loadDefaultNetInfo(): NetInfoLike {
  if (_netInfoSource) return _netInfoSource;
  // Lazy require — keeps node:test runs from resolving the RN-only module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-community/netinfo') as {
    default: {
      addEventListener: (
        cb: (s: NetInfoLikeState) => void,
      ) => () => void;
      fetch: () => Promise<NetInfoLikeState>;
    };
  };
  const NetInfo = mod.default;
  _netInfoSource = {
    addEventListener: (cb) => NetInfo.addEventListener((s) => cb(s)),
    fetch: () => NetInfo.fetch(),
  };
  return _netInfoSource;
}

/** Tests inject a stub source. Pass `null` to restore the lazy default. */
export function __setNetInfoSourceForTest(source: NetInfoLike | null): void {
  _netInfoSource = source;
}

function resolveNetInfo(): NetInfoLike {
  if (_netInfoSource) return _netInfoSource;
  return loadDefaultNetInfo();
}

// ---------------------------------------------------------------------------
// Pure state reducer
// ---------------------------------------------------------------------------

export interface NetworkState {
  online: boolean;
  lastSeenOnline: Date | null;
}

const INITIAL_STATE: NetworkState = { online: true, lastSeenOnline: null };

/**
 * Reduce a fresh NetInfo reading into the next `NetworkState`. Identity-
 * stable when the connectivity status doesn't change so React consumers
 * don't re-render on every poll. `lastSeenOnline` only moves at a
 * transition boundary — both directions capture the moment.
 */
export function deriveNetworkState(
  prev: NetworkState,
  next: NetInfoLikeState,
  now: () => number = Date.now,
): NetworkState {
  if (next.isConnected === null || next.isConnected === undefined) {
    return prev;
  }
  const reachable = next.isInternetReachable;
  // `isInternetReachable === false` is a definitive "no internet" — treat
  // it as offline. `null`/`undefined` means "unknown", in which case fall
  // back to `isConnected`.
  const online = next.isConnected === true && reachable !== false;
  if (online === prev.online) return prev;
  return { online, lastSeenOnline: new Date(now()) };
}

// ---------------------------------------------------------------------------
// React provider + hook
// ---------------------------------------------------------------------------

const NetworkContext = React.createContext<NetworkState | null>(null);

export interface NetworkProviderProps {
  children?: React.ReactNode;
  /** Tests inject a stub. Falls back to the lazy NetInfo default. */
  source?: NetInfoLike;
  /** Override the time source. Useful for deterministic tests. */
  now?: () => number;
}

export function NetworkProvider({
  children,
  source,
  now,
}: NetworkProviderProps): React.JSX.Element {
  const [state, setState] = React.useState<NetworkState>(INITIAL_STATE);

  React.useEffect(() => {
    const src = source ?? resolveNetInfo();
    let cancelled = false;
    const apply = (next: NetInfoLikeState): void => {
      if (cancelled) return;
      setState((prev) => deriveNetworkState(prev, next, now));
    };
    // Seed with the current reading so consumers don't render a wrong
    // "online" state for a tick.
    src.fetch().then(apply).catch(() => undefined);
    const unsub = src.addEventListener(apply);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [source, now]);

  return React.createElement(NetworkContext.Provider, { value: state }, children);
}

export function useNetwork(): NetworkState {
  const ctx = React.useContext(NetworkContext);
  if (!ctx) {
    // Render outside the provider — assume online and don't crash. The
    // alternative (throwing) would take the whole app down if a screen
    // mounted before the provider tree was wired.
    return INITIAL_STATE;
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Outbox accessor
// ---------------------------------------------------------------------------
//
// The replay machinery shares the same `Outbox` instance that mutation
// sites (Add / Edit / Setlist / Action sheet) use via `getCacheOutbox`.
// Two key invariants come out of this unification:
//
//   1. Sign-out's `deleteCacheDatabase()` resets the singleton in
//      `cache/db.ts`, so the next mutation after a sign-in re-binds to
//      a fresh database. If `network.ts` cached its own promise, the
//      stale handle would survive across users.
//   2. There's exactly one `pending_writes` row per pending mutation,
//      and the polling drawer + reconnect replay observe the same
//      writes the user just enqueued.
//
// `getOutbox()` stays async to preserve the M6.A surface — the
// underlying `getCacheOutbox()` is sync. Tests can override the
// opener via `__setOutboxOpenerForTest` (used by `network.test.ts`).

export type OutboxOpener = () => Outbox | Promise<Outbox>;

const defaultOutboxOpener: OutboxOpener = () => getCacheOutbox();

let _outboxOpener: OutboxOpener = defaultOutboxOpener;

export async function getOutbox(): Promise<Outbox> {
  return _outboxOpener();
}

export function __setOutboxOpenerForTest(opener: OutboxOpener | null): void {
  _outboxOpener = opener ?? defaultOutboxOpener;
}

// ---------------------------------------------------------------------------
// Outbox replay
// ---------------------------------------------------------------------------

export type OutboxDispatch = (write: PendingWrite) => Promise<unknown>;

export interface ReplayOptions {
  outbox: Outbox;
  dispatch: OutboxDispatch;
  /** Async sleep helper. Tests pass a no-op or fake-timer driven impl. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Backoff schedule for transient (5xx / network) failures. Each entry
   * is the delay before the corresponding retry. The total number of
   * attempts per row is `backoffMs.length + 1`.
   */
  backoffMs?: readonly number[];
}

const DEFAULT_BACKOFF_MS: readonly number[] = [500, 1500, 4000];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ClassifiedError {
  status: number;
  /** True for network errors and 5xx — safe to retry. */
  transient: boolean;
  message: string;
}

function classifyError(err: unknown): ClassifiedError {
  const e = err as {
    data?: { httpStatus?: number };
    status?: number;
    cause?: { status?: number };
    message?: string;
  } | null | undefined;
  const status =
    e?.data?.httpStatus ??
    e?.status ??
    e?.cause?.status ??
    0;
  // Status 0 = network error (no response at all). Treat as transient.
  const transient = status === 0 || status >= 500;
  const message = err instanceof Error ? err.message : String((e?.message ?? err) ?? 'unknown');
  return { status, transient, message };
}

/**
 * Walk the outbox in FIFO order and fire `dispatch` for each row.
 * Drops successful rows; records the last error on failures. Transient
 * errors back off and retry inside the same call up to
 * `backoffMs.length + 1` total attempts.
 *
 * Each iteration re-checks `outbox.get(id)` before dispatching. This
 * closes a race where a sign-out (which calls `deleteCacheDatabase`)
 * happens mid-replay: the pending row is wiped from disk, the next
 * `outbox.get` returns null, and the loop skips applying a stale write
 * against a different user's session.
 */
export async function replayOutbox(opts: ReplayOptions): Promise<void> {
  const sleep = opts.sleep ?? defaultSleep;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const writes = await opts.outbox.list();
  for (const write of writes) {
    let attempt = 0;
    while (true) {
      // Defensive: another caller (sign-out cleanup, drawer discard,
      // a parallel replay) may have removed this row while we were
      // sleeping/retrying. Apply only what's still pending.
      const stillPending = await opts.outbox.get(write.id).catch(() => null);
      if (!stillPending) break;
      try {
        await opts.dispatch(write);
        await opts.outbox.drop(write.id);
        break;
      } catch (err) {
        const cls = classifyError(err);
        await opts.outbox.recordFailure(write.id, cls.message);
        if (cls.transient && attempt < backoff.length) {
          await sleep(backoff[attempt]!);
          attempt += 1;
          continue;
        }
        // 4xx or backoff exhausted — leave the row in place, move on.
        break;
      }
    }
  }
}

let _replayInFlight: Promise<void> | null = null;

/**
 * Single-flight wrapper around `replayOutbox`. Concurrent callers receive
 * the same in-flight promise. Resets when the underlying replay settles.
 */
export function replayOutboxOnce(opts: ReplayOptions): Promise<void> {
  if (_replayInFlight) return _replayInFlight;
  const p = (async () => {
    try {
      await replayOutbox(opts);
    } finally {
      _replayInFlight = null;
    }
  })();
  _replayInFlight = p;
  return p;
}

export function __resetReplayInFlightForTest(): void {
  _replayInFlight = null;
}

// ---------------------------------------------------------------------------
// OfflineSyncProvider — orchestration glue used by the layout
// ---------------------------------------------------------------------------

const OFFLINE_BANNER_TEXT = "You're offline. Changes will sync when you're back.";

export interface OfflineSyncContextValue {
  /** Snapshot of the outbox as of the most recent poll. */
  entries: PendingWrite[];
  count: number;
  /** True while a replay pass is in flight. */
  syncing: boolean;
  /** Manual retry — kicks `replayOutboxOnce` if connected. */
  retry: () => void;
  /** Drop a pending row. Used by the drawer's discard button. */
  discard: (id: string) => Promise<void>;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const OfflineSyncContext = React.createContext<OfflineSyncContextValue | null>(null);

export interface OfflineSyncProviderProps {
  children: React.ReactNode;
  /**
   * Dispatch a single pending write. The layout passes a closure that
   * maps `mutation` to the matching tRPC procedure. Kept as a prop so
   * this module doesn't depend on tRPC.
   */
  dispatch: OutboxDispatch;
  /** Poll cadence for outbox snapshots. Defaults to 2s. */
  pollMs?: number;
  /** Tests inject a pre-built outbox. Falls back to `getOutbox()`. */
  outbox?: Outbox;
}

export function OfflineSyncProvider({
  children,
  dispatch,
  pollMs = 2000,
  outbox: outboxProp,
}: OfflineSyncProviderProps): React.JSX.Element {
  const network = useNetwork();
  const { showBanner, dismissBanner } = useFeedback();
  const [outbox, setOutbox] = React.useState<Outbox | null>(outboxProp ?? null);
  const [entries, setEntries] = React.useState<PendingWrite[]>([]);
  const [syncing, setSyncing] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Stable refs so the reconnect effect doesn't re-fire when callers
  // change identity.
  const dispatchRef = React.useRef(dispatch);
  React.useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // Lazy-open the singleton outbox on mount.
  React.useEffect(() => {
    if (outboxProp) {
      setOutbox(outboxProp);
      return;
    }
    let cancelled = false;
    void getOutbox()
      .then((ob) => {
        if (!cancelled) setOutbox(ob);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [outboxProp]);

  const refresh = React.useCallback(async () => {
    if (!outbox) return;
    try {
      const list = await outbox.list();
      setEntries(list);
    } catch {
      // Outbox failures must never break the app.
    }
  }, [outbox]);

  // Poll the outbox so the drawer + Me tab badge stay in sync without
  // every mutation site notifying us.
  React.useEffect(() => {
    if (!outbox) return;
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, pollMs);
    return () => clearInterval(id);
  }, [outbox, pollMs, refresh]);

  // Persistent offline banner. Held as a ref so we can dismiss it on
  // reconnect without losing track of the id.
  const offlineBannerIdRef = React.useRef<string | null>(null);
  const syncingBannerIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!network.online) {
      if (!offlineBannerIdRef.current) {
        offlineBannerIdRef.current = showBanner({
          kind: 'info',
          text: OFFLINE_BANNER_TEXT,
        });
      }
      return;
    }
    if (offlineBannerIdRef.current) {
      dismissBanner(offlineBannerIdRef.current);
      offlineBannerIdRef.current = null;
    }
  }, [network.online, showBanner, dismissBanner]);

  const runReplay = React.useCallback(async () => {
    if (!outbox) return;
    const before = await outbox.list().catch(() => [] as PendingWrite[]);
    if (before.length === 0) return;
    setSyncing(true);
    if (syncingBannerIdRef.current) {
      dismissBanner(syncingBannerIdRef.current);
      syncingBannerIdRef.current = null;
    }
    syncingBannerIdRef.current = showBanner({
      kind: 'info',
      text: `Syncing ${before.length} change${before.length === 1 ? '' : 's'}…`,
    });
    try {
      await replayOutboxOnce({ outbox, dispatch: dispatchRef.current });
    } finally {
      setSyncing(false);
      if (syncingBannerIdRef.current) {
        dismissBanner(syncingBannerIdRef.current);
        syncingBannerIdRef.current = null;
      }
      void refresh();
    }
  }, [outbox, showBanner, dismissBanner, refresh]);

  // Auto-replay on reconnect. The single-flight wrapper handles repeat
  // online events that fire while the previous pass is still running.
  const wasOnlineRef = React.useRef(network.online);
  React.useEffect(() => {
    const wasOnline = wasOnlineRef.current;
    wasOnlineRef.current = network.online;
    if (!network.online) return;
    if (wasOnline) return; // No transition.
    if (!outbox) return;
    void runReplay();
  }, [network.online, outbox, runReplay]);

  const retry = React.useCallback(() => {
    if (!network.online) return;
    void runReplay();
  }, [network.online, runReplay]);

  const discard = React.useCallback(
    async (id: string) => {
      if (!outbox) return;
      await outbox.drop(id).catch(() => undefined);
      await refresh();
    },
    [outbox, refresh],
  );

  const value = React.useMemo<OfflineSyncContextValue>(
    () => ({
      entries,
      count: entries.length,
      syncing,
      retry,
      discard,
      drawerOpen,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
    }),
    [entries, syncing, retry, discard, drawerOpen],
  );

  return React.createElement(OfflineSyncContext.Provider, { value }, children);
}

export function useOfflineSync(): OfflineSyncContextValue {
  const ctx = React.useContext(OfflineSyncContext);
  if (!ctx) {
    return {
      entries: [],
      count: 0,
      syncing: false,
      retry: () => undefined,
      discard: async () => undefined,
      drawerOpen: false,
      openDrawer: () => undefined,
      closeDrawer: () => undefined,
    };
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Re-exports for consumers (drawer + tests)
// ---------------------------------------------------------------------------

export type { Outbox, PendingWrite, PendingMutation } from './cache/outbox';
