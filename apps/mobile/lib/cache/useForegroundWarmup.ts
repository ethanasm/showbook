/**
 * `useForegroundWarmup` — fires `warmCacheForOfflineUse` when the app
 * returns to the foreground AND the last successful warm-up was more
 * than `WARMUP_TTL_MS` ago.
 *
 * Sister to `useForegroundSync` (which only invalidates active queries on
 * foreground). They're complementary: invalidate refreshes whatever the
 * user is looking at right now, warm-up refreshes everything the user
 * might look at offline next. React Query dedupes the overlap.
 *
 * Owns its own AppState listener so it can stay decoupled from
 * `useForegroundSync`; if the latter ever moves out of `CacheBridge`,
 * this hook keeps working.
 */

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';

import {
  readLastWarmup,
  warmCacheForOfflineUse,
  type WarmupClientSurface,
} from './warmup';

const DEFAULT_WARMUP_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export interface UseForegroundWarmupOptions {
  /** Override the staleness window in ms. Default 6h. */
  ttlMs?: number;
  /** Tests inject a stub AppState. */
  appState?: Pick<typeof AppState, 'addEventListener' | 'currentState'>;
  /** Tests inject the warm-up function. */
  warm?: typeof warmCacheForOfflineUse;
  /** Tests inject the clock. */
  now?: () => number;
}

export function useForegroundWarmup(
  client: WarmupClientSurface | null,
  queryClient: QueryClient,
  userId: string | null,
  options: UseForegroundWarmupOptions = {},
): void {
  const ttlMs = options.ttlMs ?? DEFAULT_WARMUP_TTL_MS;
  const appState = options.appState ?? AppState;
  const warm = options.warm ?? warmCacheForOfflineUse;
  const now = options.now ?? Date.now;

  // Refs so the effect doesn't re-mount when these change. The
  // foreground event itself reads the freshest values.
  const clientRef = useRef(client);
  const userRef = useRef(userId);
  useEffect(() => {
    clientRef.current = client;
  }, [client]);
  useEffect(() => {
    userRef.current = userId;
  }, [userId]);

  useEffect(() => {
    let last: AppStateStatus = appState.currentState;
    const sub: NativeEventSubscription = appState.addEventListener('change', (next) => {
      const wasInactive = last !== 'active';
      last = next;
      if (!wasInactive || next !== 'active') return;
      if (!userRef.current) return; // Not signed in — nothing to warm.
      const c = clientRef.current;
      if (!c) return;
      const lastWarmupAt = readLastWarmup(queryClient);
      if (lastWarmupAt && now() - lastWarmupAt < ttlMs) return;
      void warm({ client: c, queryClient }).catch(() => undefined);
    });
    return () => sub.remove();
  }, [appState, queryClient, warm, ttlMs, now]);
}
