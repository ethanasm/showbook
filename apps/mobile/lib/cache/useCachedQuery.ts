/**
 * `useCachedQuery` — a thin wrapper around `@tanstack/react-query`'s
 * `useQuery` that reads its initial value from the persistent cache
 * (when one has been hydrated into the QueryClient via
 * `hydrateQueryClient`) and keeps the same default freshness window
 * everywhere in the app.
 *
 * In M2.A this hook intentionally does very little — it only sets
 * sensible defaults (longer `gcTime` so the persister actually has
 * something to write back, `placeholderData: keepPreviousData`-style
 * stickiness via `structuralSharing`). The persister handles the
 * disk side; React Query does the rest.
 *
 * Future milestones layer offline-first behaviour on top: M6 will
 * add an outbox + offline detection. Keep this surface small until
 * then so callers can swap it out without ceremony.
 */

import { useQuery, type QueryKey, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';

const DEFAULT_GC_TIME_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_STALE_TIME_MS = 30_000;

export type CachedQueryOptions<TData, TError = Error> = UseQueryOptions<
  TData,
  TError,
  TData,
  QueryKey
>;

export function useCachedQuery<TData, TError = Error>(
  options: CachedQueryOptions<TData, TError>,
): UseQueryResult<TData, TError> {
  return useQuery<TData, TError, TData, QueryKey>({
    gcTime: DEFAULT_GC_TIME_MS,
    staleTime: DEFAULT_STALE_TIME_MS,
    ...options,
  });
}

export const CACHE_DEFAULTS = {
  gcTime: DEFAULT_GC_TIME_MS,
  staleTime: DEFAULT_STALE_TIME_MS,
};
