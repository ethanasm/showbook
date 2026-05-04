import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, createContext } from '@showbook/api';
import { child } from '@showbook/observability';
import { auth } from '@/auth';
import { decodeMobileToken } from '@/lib/mobile-token';
import { isEmailAllowed, readAllowlistFromEnv } from '@/lib/auth-allowlist';
import { resolveTrpcSession } from './resolve-session';

const log = child({ component: 'web.trpc' });

const CLIENT_ERROR_CODES = new Set([
  'PARSE_ERROR',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_SUPPORTED',
  'TIMEOUT',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'UNPROCESSABLE_CONTENT',
  'TOO_MANY_REQUESTS',
  'CLIENT_CLOSED_REQUEST',
]);

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
  // Resolve the session via the pure helper. The helper deliberately
  // doesn't call any IO so it can be unit-tested; this handler binds the
  // real decoders and supplies the cookie session lazily so we only pay
  // the auth() cost when bearer auth doesn't apply.
  const session = await resolveTrpcSession({
    authHeader: req.headers.get('authorization'),
    secret: AUTH_SECRET,
    decode: decodeMobileToken,
    allowlist: readAllowlistFromEnv(),
    isEmailAllowed,
    getCookieSession: async () => {
      const cookieSession = await auth();
      return cookieSession?.user?.id ? { user: { id: cookieSession.user.id } } : null;
    },
    log,
  });

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext({ session }),
    onError: ({ path, error }) => {
      // 4xx-equivalent codes are expected client conditions (stale
      // session cookie after a user is deleted, missing required input,
      // unauthorized access attempts). Logging them at error level
      // pollutes alerting; demote to warn so genuine 5xx server errors
      // remain the only thing on the error channel.
      const isClientError = CLIENT_ERROR_CODES.has(error.code);
      const payload = {
        err: error,
        event: 'trpc.error',
        path: path ?? 'unknown',
        userId: session?.user?.id,
        code: error.code,
      };
      if (isClientError) log.warn(payload, 'tRPC client error');
      else log.error(payload, 'tRPC procedure error');
    },
  });
};

export { handler as GET, handler as POST };
