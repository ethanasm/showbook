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
 * it is `authjs.session-token`. Because mobile Bearer tokens are not bound to a
 * cookie, we always use `authjs.session-token` as the salt — consistent with the
 * test login route in /api/test/login and independent of whether the web app
 * happens to be on HTTP or HTTPS. encode and decode MUST use the same salt.
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
 * Upsert the user + account rows. Idempotent — safe to call on every sign-in.
 *
 * Lookup order:
 *   1. Find an existing `accounts` row for (provider='google', providerAccountId=googleSub).
 *      If found, fetch and return the linked user.
 *   2. Otherwise insert a new `users` row, then a new `accounts` row pointing at it.
 *
 * This mirrors the DrizzleAdapter's linkAccount + createUser flow so the rows
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

  // 1. Check for existing account
  const existingAccount = await drizzle.query.accounts.findFirst({
    where: and(
      eq(accounts.provider, 'google'),
      eq(accounts.providerAccountId, args.googleSub),
    ),
  });

  if (existingAccount) {
    // Account exists — fetch the user row
    const existingUser = await drizzle.query.users.findFirst({
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

  // 2. New user: insert user row then account row
  const [newUser] = await drizzle
    .insert(users)
    .values({
      email: args.email,
      name: args.name,
      image: args.image,
      emailVerified: args.emailVerified ? new Date() : null,
    })
    .returning();

  if (!newUser) throw new Error('Failed to insert new user');

  await drizzle.insert(accounts).values({
    userId: newUser.id,
    type: 'oauth',
    provider: 'google',
    providerAccountId: args.googleSub,
  });

  return {
    id: newUser.id,
    email: newUser.email ?? args.email,
    name: newUser.name ?? null,
    image: newUser.image ?? null,
  };
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
 * Decode + verify a mobile JWT. Returns `{ id }` on success, null on invalid/expired.
 * Used by the tRPC route handler to validate `Authorization: Bearer <token>`.
 */
export async function decodeMobileToken(args: {
  token: string;
  secret: string;
}): Promise<{ id: string } | null> {
  try {
    const payload = await decode({
      token: args.token,
      secret: args.secret,
      salt: MOBILE_JWT_SALT,
    });
    if (!payload) return null;
    const id = (payload as Record<string, unknown>).id as string | undefined;
    if (!id) return null;
    return { id };
  } catch {
    return null;
  }
}
