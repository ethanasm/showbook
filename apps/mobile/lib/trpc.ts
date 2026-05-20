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

import { MutationCache, QueryClient } from '@tanstack/react-query';
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import type { TRPCLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@showbook/api';
import { API_URL } from './env';
import { hapticSuccess, hapticWarning } from './haptics';
import { reportClientEvent, describeError } from './telemetry';

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

export function createQueryClient(): QueryClient {
  return new QueryClient({
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
      onError: () => {
        void hapticWarning();
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
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
                reportClientEvent({
                  event: 'trpc.error',
                  message: describeError(err),
                  level: 'error',
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
