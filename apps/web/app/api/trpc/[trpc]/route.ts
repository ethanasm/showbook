import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, createContext } from '@showbook/api';
import { child } from '@showbook/observability';
import { auth } from '@/auth';
import { decodeMobileToken } from '@/lib/mobile-token';

const log = child({ component: 'web.trpc' });

const handler = async (req: Request) => {
  // Resolve the session from either a Bearer token (mobile) or the NextAuth
  // cookie (web). Bearer path takes precedence so the mobile app never needs
  // cookies.
  let session: { user: { id: string } } | null = null;

  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const rawToken = authHeader.slice(7);
    const decoded = await decodeMobileToken({
      token: rawToken,
      secret: process.env.AUTH_SECRET ?? '',
    });
    if (decoded) {
      session = { user: { id: decoded.id } };
    }
  }

  if (!session) {
    const cookieSession = await auth();
    session = cookieSession?.user?.id ? { user: { id: cookieSession.user.id } } : null;
  }

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext({ session }),
    onError: ({ path, error }) => {
      log.error(
        { err: error, event: 'trpc.error', path: path ?? 'unknown', userId: session?.user?.id },
        'tRPC procedure error',
      );
    },
  });
};

export { handler as GET, handler as POST };
