/**
 * Mount-once hook that refetches active React Query data when the
 * app returns to the foreground. The pure trigger lives in
 * `sync.ts` so this file is the only one in the cache layer that
 * depends on `react-native`.
 */

import { useEffect } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';

import { triggerForegroundSync } from './sync';

export interface UseForegroundSyncOptions {
  appState?: Pick<typeof AppState, 'addEventListener' | 'currentState'>;
  trigger?: (qc: QueryClient) => void | Promise<void>;
}

export function useForegroundSync(
  queryClient: QueryClient,
  options: UseForegroundSyncOptions = {},
): void {
  const trigger = options.trigger ?? triggerForegroundSync;
  const appState = options.appState ?? AppState;
  useEffect(() => {
    let last: AppStateStatus = appState.currentState;
    const sub: NativeEventSubscription = appState.addEventListener(
      'change',
      (next) => {
        if (last !== 'active' && next === 'active') {
          void trigger(queryClient);
        }
        last = next;
      },
    );
    return () => sub.remove();
  }, [queryClient, trigger, appState]);
}
