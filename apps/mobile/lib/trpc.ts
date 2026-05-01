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

import { QueryClient } from '@tanstack/react-query';
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import superjson from 'superjson';
import type { AppRouter } from '@showbook/api';
import { API_URL } from './env';

export const trpc = createTRPCReact<AppRouter>();

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export function createTrpcClient(getToken: () => string | null) {
  return trpc.createClient({
    links: [
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
