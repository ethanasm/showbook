/**
 * Pure-logic helpers for the mobile auth bridge.
 *
 * Mobile clients perform Google OAuth natively (Expo AuthSession) and POST
 * the resulting Google ID token to /api/auth/mobile-token. This module:
 *  1. Verifies that ID token against Google's public keys (verifyGoogleIdToken)
 *  2. Upserts the user + account rows in the same shape the DrizzleAdapter uses (upsertUserFromGoogle)
 *  3. Mints a JWT compatible with NextAuth's cookie format (encodeMobileToken)
 *  4. Decodes / verifies that JWT for the tRPC Bearer path (decodeMobileToken)
 *
 * Salt note: Auth.js encodes its session cookie with `salt = cookieName`.
 * For HTTPS the cookie name is `__Secure-authjs.session-token`; for plain HTTP
 * it is `authjs.session-token`. Mobile tokens are not cookies, so we use a
 * stable, protocol-independent salt ('authjs.session-token' — the non-secure
 * cookie name). This intentionally diverges from the cookie path's
 * protocol-conditional salt so a mobile token never collides with a cookie
 * token, even if one were submitted as the other. encode and decode MUST use
 * the same salt.
 */

import { encode, decode } from 'next-auth/jwt';
import { OAuth2Client } from 'google-auth-library';
import { db as defaultDb, users, accounts, eq, and } from '@showbook/db';
import type { Database } from '@showbook/db';

// Salt used for all mobile Bearer JWTs. Must be the same in encode and decode.
// We use the non-secure cookie name so it is stable regardless of protocol.
export const MOBILE_JWT_SALT = 'authjs.session-token';

// Default token lifetime: 30 days, matching NextAuth's default session.
const DEFAULT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Google ID token verification
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the Google OAuth2Client needed by verifyGoogleIdToken.
 * Using an interface makes it easy to inject a fake in tests without needing
 * mock.module (which is not available in this Node version).
 */
export interface GoogleOAuth2Client {
  verifyIdToken(opts: {
    idToken: string;
    audience: string | string[];
  }): Promise<{ getPayload(): GoogleIdTokenPayload | null | undefined }>;
}

export interface GoogleIdTokenPayload {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

/**
 * Verify a Google ID token. Returns the verified payload or throws.
 * `audiences` must include the iOS and/or Android OAuth client ID(s) that
 * were used to obtain the token — Google rejects tokens with mismatched aud.
 *
 * `client` is optional; defaults to a real OAuth2Client. Pass a fake in tests.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  audiences: string[],
  client?: GoogleOAuth2Client,
): Promise<{
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
}> {
  const oauth2Client = client ?? new OAuth2Client();
  const ticket = await oauth2Client.verifyIdToken({ idToken, audience: audiences });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error('Google ID token missing required claims (sub, email)');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: payload.name ?? null,
    image: payload.picture ?? null,
  };
}

// ---------------------------------------------------------------------------
// User upsert  (mirrors @auth/drizzle-adapter behaviour)
// ---------------------------------------------------------------------------

/**
 * Upsert the user + account rows. Idempotent and concurrency-safe.
 *
 * Concurrency strategy: a UNIQUE INDEX on accounts(provider, provider_account_id)
 * (migration 0022) is the single source of truth. The function wraps everything
 * in a transaction and handles the race like this:
 *
 *   1. Inside the transaction, look up the accounts row for this Google sub.
 *   2. If it already exists, return the linked user — done.
 *   3. If it doesn't exist, insert a new users row, then insert the accounts
 *      row with ON CONFLICT DO NOTHING (in case a concurrent transaction just
 *      beat us to it and committed between our lookup and our insert).
 *   4. After the accounts insert, re-query for the accounts row. If we won
 *      the race it's our new row; if we lost it's the concurrent winner's row.
 *      Either way we get the stable userId from it.
 *   5. Fetch and return the user row for that userId.
 *
 * This means: in the concurrent-first-login case, two users rows may be
 * created, but only one accounts row survives (due to ON CONFLICT DO NOTHING).
 * The "extra" users row is an orphan — it has no accounts row pointing at it
 * and will never be used. This is acceptable: it's rare, not a security issue,
 * and far preferable to two users rows each with an accounts row pointing at
 * them (which is the scenario without this constraint).
 *
 * This mirrors the DrizzleAdapter's linkAccount + createUser flow so rows
 * are indistinguishable from those created by the web OAuth flow.
 */
export async function upsertUserFromGoogle(args: {
  db?: Database;
  googleSub: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
}): Promise<{ id: string; email: string; name: string | null; image: string | null }> {
  const drizzle = args.db ?? defaultDb;

  return drizzle.transaction(async (tx) => {
    // 1. Check for existing account (inside tx for isolation)
    const existingAccount = await tx.query.accounts.findFirst({
      where: and(
        eq(accounts.provider, 'google'),
        eq(accounts.providerAccountId, args.googleSub),
      ),
    });

    if (existingAccount) {
      // Account exists — fetch the user row
      const existingUser = await tx.query.users.findFirst({
        where: eq(users.id, existingAccount.userId),
      });
      if (!existingUser) {
        throw new Error(`Account row found but user ${existingAccount.userId} is missing`);
      }
      return {
        id: existingUser.id,
        email: existingUser.email ?? args.email,
        name: existingUser.name ?? null,
        image: existingUser.image ?? null,
      };
    }

    // 2. No account yet — insert a new user row
    const [newUser] = await tx
      .insert(users)
      .values({
        email: args.email,
        name: args.name,
        image: args.image,
        emailVerified: args.emailVerified ? new Date() : null,
      })
      .returning();

    if (!newUser) throw new Error('Failed to insert new user');

    // 3. Insert the accounts row; ON CONFLICT DO NOTHING handles the race
    //    where a concurrent transaction committed an accounts row between our
    //    lookup (step 1) and now. The UNIQUE INDEX on (provider, provider_account_id)
    //    is what makes ON CONFLICT DO NOTHING effective here.
    await tx
      .insert(accounts)
      .values({
        userId: newUser.id,
        type: 'oauth',
        provider: 'google',
        providerAccountId: args.googleSub,
      })
      .onConflictDoNothing();

    // 4. Re-query to get the definitive accounts row (ours or the concurrent winner's)
    const finalAccount = await tx.query.accounts.findFirst({
      where: and(
        eq(accounts.provider, 'google'),
        eq(accounts.providerAccountId, args.googleSub),
      ),
    });

    if (!finalAccount) {
      // Should be impossible: we just inserted with ON CONFLICT DO NOTHING,
      // so either our row or a concurrent row must exist.
      throw new Error('Failed to find accounts row after upsert');
    }

    // 5. If the winning userId is ours, we can return newUser directly
    if (finalAccount.userId === newUser.id) {
      return {
        id: newUser.id,
        email: newUser.email ?? args.email,
        name: newUser.name ?? null,
        image: newUser.image ?? null,
      };
    }

    // 5b. A concurrent transaction won — fetch their user row
    const winningUser = await tx.query.users.findFirst({
      where: eq(users.id, finalAccount.userId),
    });
    if (!winningUser) {
      throw new Error(`Concurrent account row found but user ${finalAccount.userId} is missing`);
    }
    return {
      id: winningUser.id,
      email: winningUser.email ?? args.email,
      name: winningUser.name ?? null,
      image: winningUser.image ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// JWT minting / verification
// ---------------------------------------------------------------------------

/**
 * Encode a NextAuth-compatible JWT for use as a mobile Bearer token.
 * The payload shape matches what auth.config.ts puts into the cookie JWT:
 * { id, sub, email, name, picture }.
 */
export async function encodeMobileToken(args: {
  userId: string;
  email: string;
  name: string | null;
  image: string | null;
  secret: string;
  maxAgeSeconds?: number;
}): Promise<string> {
  return encode({
    token: {
      sub: args.userId,
      id: args.userId,
      email: args.email,
      name: args.name,
      picture: args.image,
    },
    secret: args.secret,
    salt: MOBILE_JWT_SALT,
    maxAge: args.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS,
  });
}

/**
 * Decode + verify a mobile JWT. Returns `{ id, email }` on success, null on
 * invalid/expired/tampered. Used by the tRPC route handler to validate
 * `Authorization: Bearer <token>`.
 *
 * Both `id` and `email` are defensively type-narrowed: a tampered token with
 * non-string claims (e.g. `id: 42`) returns null rather than casting blindly.
 */
export async function decodeMobileToken(args: {
  token: string;
  secret: string;
}): Promise<{ id: string; email: string | null } | null> {
  try {
    const payload = await decode({
      token: args.token,
      secret: args.secret,
      salt: MOBILE_JWT_SALT,
    });
    if (!payload) return null;
    const raw = payload as Record<string, unknown>;
    const id = raw.id;
    if (typeof id !== 'string' || !id) return null;
    const email = raw.email;
    const emailValue: string | null = typeof email === 'string' ? email : null;
    return { id, email: emailValue };
  } catch {
    return null;
  }
}
