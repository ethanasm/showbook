/**
 * Pure session-resolution helper for the tRPC route.
 *
 * Lives in its own file so it can be unit-tested without spinning up a
 * Next.js fetch handler or the NextAuth `auth()` helper. Callers (the
 * route handler) inject the real decoders and cookie-session getter; the
 * tests inject fakes.
 *
 * Auth precedence (matches the prior inline implementation):
 *
 *   1. If `Authorization: Bearer <token>` is present and AUTH_SECRET is
 *      configured, decode the bearer and use it. This is the mobile path.
 *      An invalid bearer does NOT fall through to cookie auth — that
 *      would silently mask token tampering from server logs and could
 *      grant access via a stale cookie session that was unrelated to the
 *      mobile request.
 *
 *   2. If the bearer decoded but the user's email is no longer on the
 *      AUTH_ALLOWED_* allowlist, treat as unauthenticated. Same rule as
 *      the cookie path's jwt callback in auth.config.ts; keeping them in
 *      sync prevents a removed-from-allowlist user from keeping mobile
 *      access until their 30-day token expires.
 *
 *   3. If no bearer header is presented at all, fall back to cookie auth.
 */

export interface ResolvedSession {
  user: { id: string };
}

export interface DecodedMobileToken {
  id: string;
  email: string | null;
}

/**
 * The minimal slice of the pino-style logger that the helper uses. Kept
 * structural so tests can pass `{ info: () => {} }` without importing
 * pino types.
 */
export interface MinimalLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

export interface ResolveTrpcSessionArgs {
  authHeader: string | null;
  secret: string | undefined;
  decode: (args: { token: string; secret: string }) => Promise<DecodedMobileToken | null>;
  allowlist: { emails: string[]; domains: string[] };
  isEmailAllowed: (
    email: string | null | undefined,
    opts: { emails: string[]; domains: string[] },
  ) => boolean;
  getCookieSession: () => Promise<ResolvedSession | null>;
  log: MinimalLogger;
}

export async function resolveTrpcSession(
  args: ResolveTrpcSessionArgs,
): Promise<ResolvedSession | null> {
  const {
    authHeader,
    secret,
    decode,
    allowlist,
    isEmailAllowed,
    getCookieSession,
    log,
  } = args;

  const hasBearer = !!authHeader && authHeader.startsWith('Bearer ');

  if (hasBearer) {
    if (!secret) {
      // No AUTH_SECRET means we can't even attempt to decode. Don't fall
      // through to cookies — a bearer presented to a misconfigured server
      // should not silently degrade.
      return null;
    }
    const rawToken = authHeader!.slice(7);
    const decoded = await decode({ token: rawToken, secret });
    if (!decoded) {
      // Invalid / expired token. Do NOT fall through to cookie auth.
      return null;
    }
    if (!isEmailAllowed(decoded.email, allowlist)) {
      log.info(
        { event: 'auth.mobile_session_denied' },
        'Mobile bearer session denied by allowlist',
      );
      return null;
    }
    return { user: { id: decoded.id } };
  }

  // No bearer presented — use the cookie session.
  return getCookieSession();
}
