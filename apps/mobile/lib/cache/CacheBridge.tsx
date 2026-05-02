/**
 * Mounts the persistent cache once the QueryClient is available:
 *  - opens the SQLite store
 *  - hydrates the QueryClient from disk
 *  - attaches a subscriber that writes successful queries back
 *  - registers an AppState listener that refetches on foreground
 *
 * This component renders nothing. It exists so the layout can express
 * "the cache is wired here" without inline `useEffect` noise.
 */

import React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  attachQueryPersister,
  createSqliteStorage,
  hydrateQueryClient,
  useForegroundSync,
} from './index';

export function CacheBridge({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    let detach: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const storage = await createSqliteStorage();
        if (cancelled) return;
        await hydrateQueryClient(queryClient, { storage });
        if (cancelled) return;
        detach = attachQueryPersister(queryClient, { storage });
      } catch {
        // Cache failures must never break the app — fall back to the
        // in-memory React Query cache.
      }
    })();
    return () => {
      cancelled = true;
      detach?.();
    };
  }, [queryClient]);

  useForegroundSync(queryClient);

  return <>{children}</>;
}
