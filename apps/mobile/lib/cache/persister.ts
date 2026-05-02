/**
 * Persist React Query state to a `CacheStorage`.
 *
 * `hydrateQueryClient` reads every entry out of storage on launch and
 * seeds the in-memory query cache. `attachQueryPersister` subscribes
 * to the cache and writes successful query results back, keyed by
 * the React Query key (stable-stringified).
 *
 * Failures from storage are swallowed and reported via the optional
 * `onError` hook — the cache layer is best-effort and must never take
 * the app down. Anything more sophisticated (size cap, eviction) lives
 * outside of M2.A.
 */

import type { QueryCacheNotifyEvent, QueryClient, QueryKey } from '@tanstack/react-query';

import { type CacheStorage, serializeQueryKey } from './storage';

export interface PersisterOptions {
  storage: CacheStorage;
  /** Optional sink for storage errors; defaults to silent. */
  onError?: (err: unknown, ctx: { op: 'read' | 'write' | 'delete'; key?: string }) => void;
  /** Override the time source; tests use this for deterministic timestamps. */
  now?: () => number;
}

export async function hydrateQueryClient(
  queryClient: QueryClient,
  options: PersisterOptions,
): Promise<void> {
  const { storage, onError } = options;
  let entries: Array<[string, { value: string; updatedAt: number }]>;
  try {
    entries = await storage.entries();
  } catch (err) {
    onError?.(err, { op: 'read' });
    return;
  }
  for (const [key, entry] of entries) {
    let queryKey: QueryKey;
    let data: unknown;
    try {
      const parsed = JSON.parse(key) as unknown;
      if (!Array.isArray(parsed)) continue;
      queryKey = parsed as QueryKey;
      data = JSON.parse(entry.value);
    } catch (err) {
      onError?.(err, { op: 'read', key });
      continue;
    }
    queryClient.setQueryData(queryKey, data, { updatedAt: entry.updatedAt });
  }
}

export function attachQueryPersister(
  queryClient: QueryClient,
  options: PersisterOptions,
): () => void {
  const { storage, onError, now = Date.now } = options;
  const cache = queryClient.getQueryCache();
  return cache.subscribe((event: QueryCacheNotifyEvent) => {
    if (event.type === 'removed') {
      const key = serializeQueryKey(event.query.queryKey);
      void storage.delete(key).catch((err) => onError?.(err, { op: 'delete', key }));
      return;
    }
    if (event.type !== 'updated') return;
    if (event.action.type !== 'success') return;
    const data = event.query.state.data;
    if (data === undefined) return;
    const key = serializeQueryKey(event.query.queryKey);
    let value: string;
    try {
      value = JSON.stringify(data);
    } catch (err) {
      onError?.(err, { op: 'write', key });
      return;
    }
    void storage
      .set(key, { value, updatedAt: now() })
      .catch((err) => onError?.(err, { op: 'write', key }));
  });
}
