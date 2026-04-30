import { cache } from "react";
import { QueryClient, dehydrate, type DehydratedState } from "@tanstack/react-query";
import { appRouter, createContext } from "@showbook/api";
import { auth } from "@/auth";

export const getQueryClient = cache(
  () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30 * 1000,
        },
      },
    }),
);

export const getServerCaller = cache(async () => {
  const session = await auth();
  return appRouter.createCaller(
    createContext({
      session: session?.user?.id ? { user: { id: session.user.id } } : null,
    }),
  );
});

// Mirror @trpc/react-query v11's getQueryKey shape so server-prefetched data
// hydrates into the client's useQuery cache. Path is the dotted procedure
// path, e.g. "shows.list".
function buildQueryKey(path: string, input: unknown): readonly unknown[] {
  const splitPath = path.split(".");
  const meta: { input?: unknown; type: "query" } = { type: "query" };
  if (typeof input !== "undefined") meta.input = input;
  return [splitPath, meta] as const;
}

export async function prefetch(
  path: string,
  input: unknown,
  fetcher: () => Promise<unknown>,
): Promise<void> {
  const qc = getQueryClient();
  await qc.prefetchQuery({
    queryKey: buildQueryKey(path, input) as unknown[],
    queryFn: fetcher,
  });
}

export function dehydrateState(): DehydratedState {
  return dehydrate(getQueryClient());
}
