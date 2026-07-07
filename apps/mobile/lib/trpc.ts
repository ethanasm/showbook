/**
 * tRPC + React Query client wiring for the mobile app.
 *
 * `@showbook/api` is a devDependency and must be imported as a *type* only —
 * Metro doesn't bundle type-only imports, so the runtime never tries to
 * resolve the server package (which pulls in node-only deps).
 *
 * The auth token is read on every request via a getter the layout passes in
 * (typically wrapped in a ref so it always sees the latest value). This way
 * we don't need to recreate the tRPC client when the user signs in/out.
 */

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import type { TRPCLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@showbook/api';
import { API_URL } from './env';
import { hapticSuccess, hapticWarning } from './haptics';
import { reportClientEvent, describeError } from './telemetry';
import { isUnauthorizedError } from './refresh-failure';
import { isTransientTrpcError, shouldRetryQuery, trpcRetryDelay } from './trpc-retry';

export const trpc = createTRPCReact<AppRouter>();

/**
 * Resolved output of a tRPC vanilla-client procedure — replaces
 * hand-mirrored interfaces. Use as
 * `RouterOutput<typeof utils.client.performers.detail.query>` (where
 * `utils` is `trpc.useUtils()`); the alias defers to the procedure's
 * inferred Promise return type so drift in the server contract becomes
 * a compile error at the call site.
 *
 * We don't import `inferRouterOutputs` from `@trpc/server` because that
 * package is a transitive dep, not declared in `apps/mobile/package.json`.
 */
export type RouterOutput<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;

// Mutation meta on mobile mirrors the web pattern (apps/web/lib/trpc.tsx):
// each useMutation can opt into a haptic via `meta.haptic`. The default
// is `'success'` so most write paths get the success cue without each
// call site opting in; pass `meta: { haptic: false }` to silence (e.g.
// silent autosave) or `'warning'` for already-flagged destructive
// confirmations. Errors always fire the warning cue.
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      haptic?: 'success' | 'warning' | false;
    };
  }
}

export interface CreateQueryClientOptions {
  /**
   * Fired whenever any query or mutation fails with an UNAUTHORIZED /
   * 401 rejection — the server no longer accepts the bearer token. The
   * layout wires this to a persistent "session expired" banner so an
   * expired session surfaces even when every screen is quietly reading
   * the offline cache (the 2026-07-05 incident: all queries 401'd
   * silently while the app kept rendering stale data). Deduplication is
   * the subscriber's job; this fires once per failed operation.
   */
  onUnauthorized?: (err: unknown) => void;
}

export function createQueryClient(opts: CreateQueryClientOptions = {}): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (err) => {
        if (isUnauthorizedError(err)) opts.onUnauthorized?.(err);
      },
    }),
    mutationCache: new MutationCache({
      onSuccess: (_data, _vars, _ctx, mutation) => {
        const cue = mutation.meta?.haptic;
        if (cue === false) return;
        if (cue === 'warning') {
          void hapticWarning();
          return;
        }
        // Default: success cue on every mutation resolution.
        void hapticSuccess();
      },
      onError: (err) => {
        void hapticWarning();
        if (isUnauthorizedError(err)) opts.onUnauthorized?.(err);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retry transient transport/edge blips (connection lost, HTML error
        // page, 5xx/429) a few times with capped backoff so a sub-few-second
        // hiccup recovers on its own instead of surfacing to the user. Real
        // 4xx rejections aren't retried — see `lib/trpc-retry.ts`.
        retry: shouldRetryQuery,
        retryDelay: trpcRetryDelay,
      },
    },
  });
}

/**
 * `errorReporterLink` reports every failed tRPC operation to the mobile
 * telemetry sink. This is what gives us Axiom visibility into mobile-side
 * failures that today are invisible to the server (the user sees a toast,
 * but ops have no record of the procedure that blew up).
 *
 * Two important guards:
 *   1. Skip the `telemetry.logEvent` op itself — otherwise a logging
 *      failure would trigger another logging call and so on.
 *   2. Swallow any reporting error so the original procedure error still
 *      surfaces to the UI exactly as it did before.
 */
function errorReporterLink(): TRPCLink<AppRouter> {
  return () =>
    ({ op, next }) =>
      observable((observer) => {
        const sub = next(op).subscribe({
          next: (value) => observer.next(value),
          error: (err) => {
            if (op.path !== 'telemetry.logEvent') {
              try {
                const data = (err as { data?: { httpStatus?: number; code?: string } })?.data;
                // A transient transport/edge blip (which queries now retry —
                // see `lib/trpc-retry.ts`) is logged at `warn`, mirroring the
                // server's `*.request.retry` convention, so it doesn't trip
                // the `error_volume` health gauge. `error` is reserved for
                // genuine, non-recoverable failures (real 4xx / app errors).
                reportClientEvent({
                  event: 'trpc.error',
                  message: describeError(err),
                  level: isTransientTrpcError(err) ? 'warn' : 'error',
                  context: {
                    path: op.path,
                    type: op.type,
                    httpStatus: data?.httpStatus,
                    code: data?.code,
                  },
                });
              } catch {
                // never let telemetry derail the original error.
              }
            }
            observer.error(err);
          },
          complete: () => observer.complete(),
        });
        return () => sub.unsubscribe();
      });
}

export function createTrpcClient(getToken: () => string | null) {
  return trpc.createClient({
    links: [
      errorReporterLink(),
      httpBatchLink({
        url: `${API_URL}/api/trpc`,
        transformer: superjson,
        headers() {
          const token = getToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
