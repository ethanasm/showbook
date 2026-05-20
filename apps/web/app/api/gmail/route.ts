import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { auth } from '@/auth';
import {
  mobileRedirectResponse,
  OAUTH_MODE_COOKIE,
  OAUTH_MODE_MOBILE,
  type OAuthMode,
} from '@/lib/gmail-popup-response';

const STATE_COOKIE = 'gmail_oauth_state';
const STATE_TTL_SECONDS = 600;

export async function GET(req: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL ?? '';
  const isSecure = baseUrl.startsWith('https');

  // Mobile opens the OAuth flow in `WebBrowser.openAuthSessionAsync` and
  // detects dismissal by URL match. The callback serves a custom-scheme
  // redirect (`showbook://gmail/connected?…`) on mobile instead of the
  // popup HTML; the opt-in is `?mode=mobile`, echoed via a cookie so the
  // callback knows which response shape to emit.
  const modeParam = req.nextUrl.searchParams.get('mode');
  const mode: OAuthMode = modeParam === OAUTH_MODE_MOBILE ? OAUTH_MODE_MOBILE : 'web';

  // Require an authenticated Showbook session before kicking off the OAuth
  // flow, and bind the flow to that session via a `state` cookie verified in
  // /api/gmail/callback (RFC 6749 §10.12).
  const session = await auth();
  if (!session?.user?.id) {
    if (mode === OAUTH_MODE_MOBILE) {
      return mobileRedirectResponse({
        payload: { type: 'error', reason: 'session_missing' },
        isSecure,
        clearState: false,
      });
    }
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const state = randomBytes(32).toString('base64url');

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${baseUrl}/api/gmail/callback`,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });

  const response = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  );

  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/api/gmail',
    maxAge: STATE_TTL_SECONDS,
  });

  // Same `httpOnly` / `lax` / `secure` / scoped-path posture as the
  // state cookie. Only set when the request explicitly opted in to the
  // mobile flow; the absence of this cookie at the callback means
  // "web popup, emit HTML."
  if (mode === OAUTH_MODE_MOBILE) {
    response.cookies.set(OAUTH_MODE_COOKIE, OAUTH_MODE_MOBILE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/api/gmail',
      maxAge: STATE_TTL_SECONDS,
    });
  }

  return response;
}
