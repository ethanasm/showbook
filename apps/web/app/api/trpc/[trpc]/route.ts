import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, createContext } from '@showbook/api';
import { child } from '@showbook/observability';
import { auth } from '@/auth';
import { decodeMobileToken } from '@/lib/mobile-token';
import { isEmailAllowed, readAllowlistFromEnv } from '@/lib/auth-allowlist';

const log = child({ component: 'web.trpc' });

// Assert AUTH_SECRET at module load. If it's missing, bearer decode is
// disabled for every request (cookie auth still works — NextAuth handles
// its own secret check). We warn once here rather than per-request to
// avoid log spam. This matches the behaviour of the mobile-token route
// which returns 500 when AUTH_SECRET is absent.
const AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET) {
  log.warn(
    { event: 'auth.mobile_session_secret_missing' },
    'AUTH_SECRET is not set — Bearer token auth is disabled for this process',
  );
}

const handler = async (req: Request) => {
  // Resolve the session from either a Bearer token (mobile) or the NextAuth
  // cookie (web). Bearer path takes precedence so the mobile app never needs
  // cookies.
  let session: { user: { id: string } } | null = null;

  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ') && AUTH_SECRET) {
    const rawToken = authHeader.slice(7);
    const decoded = await decodeMobileToken({
      token: rawToken,
      secret: AUTH_SECRET,
    });
    if (decoded) {
      // Re-check the email allowlist on every Bearer request, matching the
      // cookie path which runs isEmailAllowed on every JWT decode in
      // auth.config.ts. Without this check, a user removed from
      // AUTH_ALLOWED_EMAILS would keep mobile access until their 30-day
      // token expired.
      const allowlist = readAllowlistFromEnv();
      if (!isEmailAllowed(decoded.email, allowlist)) {
        // Treat as unauthenticated — do NOT fall through to cookie path.
        log.info(
          { event: 'auth.mobile_session_denied' },
          'Mobile bearer session denied by allowlist',
        );
        // session stays null
      } else {
        session = { user: { id: decoded.id } };
      }
    }
    // If decoded is null (invalid/expired token), session stays null and
    // we do NOT fall through to cookie auth — bearer and cookie are
    // separate auth paths.
  }

  if (!session && !authHeader?.startsWith('Bearer ')) {
    // Only attempt cookie auth if no Bearer header was presented.
    // A presented-but-invalid Bearer token should not silently fall back
    // to cookies (which could mask token tampering from server logs).
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
