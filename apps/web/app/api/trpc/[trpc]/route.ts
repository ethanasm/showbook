import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, createContext } from '@showbook/api';
import { child } from '@showbook/observability';
import { auth } from '@/auth';

const log = child({ component: 'web.trpc' });

const handler = async (req: Request) => {
  const session = await auth();

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () =>
      createContext({
        session: session?.user?.id ? { user: { id: session.user.id } } : null,
      }),
    onError: ({ path, error }) => {
      log.error(
        { err: error, event: 'trpc.error', path: path ?? 'unknown', userId: session?.user?.id },
        'tRPC procedure error',
      );
    },
  });
};

export { handler as GET, handler as POST };
