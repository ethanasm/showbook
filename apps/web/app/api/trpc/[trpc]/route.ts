import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, createContext } from '@showbook/api';
import { auth } from '@/auth';

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
  });
};

export { handler as GET, handler as POST };
