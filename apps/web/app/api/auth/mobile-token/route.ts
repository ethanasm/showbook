/**
 * POST /api/auth/mobile-token
 *
 * Exchange a Google ID token (obtained natively via Expo AuthSession) for a
 * NextAuth-compatible JWT that the mobile app can send as `Authorization: Bearer <token>`
 * on subsequent tRPC requests.
 *
 * Required env vars:
 *   AUTH_SECRET                     — NextAuth secret (used for JWT signing)
 *   GOOGLE_OAUTH_MOBILE_AUDIENCES   — comma-separated iOS + Android OAuth client IDs
 *
 * Returns:
 *   200 { token: string, user: { id, email, name, image } }
 *   400 { error: 'bad_request', details: string }    body parse / validation failure
 *   401 { error: 'invalid_token' }                   Google verification failed
 *   403 { error: 'access_denied' }                   email not on allowlist
 *   500 { error: 'server_error' }                    missing config / unexpected failure
 */

import { NextResponse } from 'next/server';
import { child } from '@showbook/observability';
import { db } from '@showbook/db';
import { readAllowlistFromEnv, shouldAllowSignIn } from '@/lib/auth-allowlist';
import {
  verifyGoogleIdToken,
  upsertUserFromGoogle,
  encodeMobileToken,
} from '@/lib/mobile-token';

const log = child({ component: 'web.auth.mobile' });

export async function POST(req: Request) {
  // Parse and validate the request body
  let idToken: string;
  try {
    const body = await req.json() as unknown;
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as Record<string, unknown>).idToken !== 'string' ||
      ((body as Record<string, unknown>).idToken as string).length < 20
    ) {
      return NextResponse.json(
        { error: 'bad_request', details: 'idToken must be a string of at least 20 characters' },
        { status: 400 },
      );
    }
    idToken = (body as Record<string, unknown>).idToken as string;
  } catch {
    return NextResponse.json(
      { error: 'bad_request', details: 'invalid JSON body' },
      { status: 400 },
    );
  }

  // Read required env vars
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    log.error({ event: 'auth.mobile_config_error' }, 'AUTH_SECRET is not set');
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  const audiencesRaw = process.env.GOOGLE_OAUTH_MOBILE_AUDIENCES;
  if (!audiencesRaw) {
    log.error(
      { event: 'auth.mobile_config_error' },
      'GOOGLE_OAUTH_MOBILE_AUDIENCES is not set',
    );
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  const audiences = audiencesRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (audiences.length === 0) {
    log.error(
      { event: 'auth.mobile_config_error' },
      'GOOGLE_OAUTH_MOBILE_AUDIENCES is empty after parsing',
    );
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  // Verify the Google ID token
  let googlePayload: {
    sub: string;
    email: string;
    emailVerified: boolean;
    name: string | null;
    image: string | null;
  };
  try {
    googlePayload = await verifyGoogleIdToken(idToken, audiences);
  } catch (err) {
    log.warn(
      { event: 'auth.mobile_token_invalid', err },
      'Google ID token verification failed',
    );
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  // Run the allowlist check (same gate as the web sign-in flow)
  const allowlist = readAllowlistFromEnv();
  const allowed = shouldAllowSignIn({
    email: googlePayload.email,
    emailVerified: googlePayload.emailVerified,
    ...allowlist,
  });
  if (!allowed) {
    log.info(
      { event: 'auth.mobile_signin_denied', email: googlePayload.email },
      'Mobile sign-in denied by allowlist',
    );
    return NextResponse.json({ error: 'access_denied' }, { status: 403 });
  }

  // Upsert user + account
  let user: { id: string; email: string; name: string | null; image: string | null };
  try {
    user = await upsertUserFromGoogle({
      db,
      googleSub: googlePayload.sub,
      email: googlePayload.email,
      name: googlePayload.name,
      image: googlePayload.image,
      emailVerified: googlePayload.emailVerified,
    });
  } catch (err) {
    log.error({ event: 'auth.mobile_upsert_error', err }, 'Failed to upsert user from Google');
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  log.info(
    { event: 'auth.mobile_signin', userId: user.id, email: user.email },
    'Mobile sign-in successful',
  );

  // Mint a NextAuth-compatible JWT
  let token: string;
  try {
    token = await encodeMobileToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      secret: authSecret,
    });
  } catch (err) {
    log.error({ event: 'auth.mobile_token_mint_error', err }, 'Failed to mint mobile JWT');
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }

  return NextResponse.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    },
  });
}
