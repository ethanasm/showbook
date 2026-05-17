'use client';

import { useState } from 'react';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createTRPCReact,
  httpBatchLink,
} from '@trpc/react-query';
import superjson from 'superjson';
import { toast } from 'sonner';
import type { AppRouter } from '@showbook/api';

export const trpc = createTRPCReact<AppRouter>();

function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  return `http://localhost:${process.env.PORT ?? 3001}`;
}

// Meta type augmentation: per-mutation `meta` lets callers opt into the
// global toast surface. `successToast` fires a sonner success on resolve;
// `errorToast` overrides the default error message (set to `false` to
// silence the global error toast for mutations that handle errors inline).
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      successToast?: string;
      errorToast?: string | false;
    };
  }
}

function defaultErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    const m = (err as { message: string }).message;
    if (m.length > 0 && m.length < 200) return m;
  }
  return 'Something went wrong';
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache({
          onSuccess: (_data, _vars, _ctx, mutation) => {
            const msg = mutation.meta?.successToast;
            if (typeof msg === 'string' && msg.length > 0) {
              toast.success(msg);
            }
          },
          onError: (err, _vars, _ctx, mutation) => {
            const override = mutation.meta?.errorToast;
            if (override === false) return;
            const msg = typeof override === 'string' && override.length > 0
              ? override
              : defaultErrorMessage(err);
            toast.error(msg);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
