/**
 * Pure helpers for surfacing manual pull-to-refresh failures.
 *
 * Background: React Query's `refetch()` never rejects — it resolves with a
 * `QueryObserverResult` whose `status` is `'error'` when the fetch failed.
 * Every pull-to-refresh call site passed that resolution to `void`, so a
 * refresh against an unreachable server (prod box down 2026-07-06) or an
 * expired session (the 2026-07-05 UNAUTHORIZED burst) looked identical to
 * a successful one: spinner, success haptic, silently stale data. These
 * helpers turn a refetch resolution into a classified, user-facing failure
 * so the RefreshControl wiring can show a toast instead of nothing.
 *
 * Lives in `lib/` so it sits inside the mobile coverage gate; the toast
 * presentation stays in `components/PullToRefresh.tsx`.
 */

import { isTransientTrpcError } from './trpc-retry';

export type RefreshFailureKind = 'session-expired' | 'unreachable' | 'error';

/**
 * Walk the resolution of a manual-refresh handler — a single
 * `refetch()` result, an array from `Promise.all`, or `undefined` from
 * fire-and-forget invalidations — and return the first failed query's
 * error, or `undefined` when everything succeeded.
 */
export function firstRefetchError(result: unknown): unknown | undefined {
  if (Array.isArray(result)) {
    for (const entry of result) {
      const err = firstRefetchError(entry);
      if (err !== undefined) return err;
    }
    return undefined;
  }
  if (result && typeof result === 'object') {
    const r = result as { status?: unknown; isError?: unknown; error?: unknown };
    if (r.status === 'error' || r.isError === true) {
      // A failed result should always carry `error`, but never return
      // undefined for a failed query — that would read as success.
      return r.error ?? new Error('Refresh failed');
    }
  }
  return undefined;
}

/**
 * Classify a refresh error for messaging:
 * - `session-expired` — the server rejected the bearer token (401 /
 *   UNAUTHORIZED). Retrying can't fix it; the user has to sign in again.
 * - `unreachable` — transport/edge failure or retryable 5xx (shares the
 *   `isTransientTrpcError` definition with the query retry policy), i.e.
 *   the server never gave a usable answer.
 * - `error` — a genuine non-auth application rejection.
 */
export function classifyRefreshFailure(err: unknown): RefreshFailureKind {
  const data = (err as { data?: { httpStatus?: unknown; code?: unknown } } | null | undefined)
    ?.data;
  if (data?.httpStatus === 401 || data?.code === 'UNAUTHORIZED') return 'session-expired';
  if (isTransientTrpcError(err)) return 'unreachable';
  return 'error';
}

export function refreshFailureMessage(kind: RefreshFailureKind): string {
  switch (kind) {
    case 'session-expired':
      return 'Session expired — sign in again to sync.';
    case 'unreachable':
      return "Can't reach Showbook — showing saved data.";
    case 'error':
      return "Couldn't refresh — showing saved data.";
  }
}
