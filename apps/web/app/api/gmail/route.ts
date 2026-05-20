import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { encode } from 'next-auth/jwt';
import { auth } from '@/auth';
import { decodeMobileToken } from '@/lib/mobile-token';
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

  // Resolve identity. Web flow uses the NextAuth session cookie (mounted at
  // /). The mobile flow's `WebBrowser.openAuthSessionAsync` runs in a
  // sandboxed browser session with no Showbook cookie jar, so the bearer
  // JWT is passed in the URL — same JWT that already authenticates every
  // mobile tRPC call. The token is only ever transmitted to our own origin
  // over HTTPS within the auth-session sandbox; it isn't forwarded to
  // Google in the subsequent redirect.
  const session = await auth();
  let userId = session?.user?.id ?? null;
  let mintedSessionEmail: string | null = null;
  let mintedFromMobileToken = false;
  if (!userId && mode === OAUTH_MODE_MOBILE) {
    const mobileToken = req.nextUrl.searchParams.get('token');
    const authSecret = process.env.AUTH_SECRET;
    if (mobileToken && authSecret) {
      const decoded = await decodeMobileToken({ token: mobileToken, secret: authSecret });
      if (decoded?.id) {
        userId = decoded.id;
        mintedSessionEmail = decoded.email;
        mintedFromMobileToken = true;
      }
    }
  }

  if (!userId) {
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

    // Mobile authenticated via the bearer-JWT query param. Mint a real
    // NextAuth-compatible session cookie so `/api/gmail/callback`'s
    // `auth()` call resolves the session naturally. Path-scoped to
    // `/api/gmail` and TTL-matched to the OAuth state so this cookie
    // can't accidentally become a long-lived web session.
    if (mintedFromMobileToken) {
      const sessionCookieName = isSecure
        ? '__Secure-authjs.session-token'
        : 'authjs.session-token';
      const sessionJwt = await encode({
        token: {
          sub: userId,
          id: userId,
          email: mintedSessionEmail,
        },
        secret: process.env.AUTH_SECRET!,
        salt: sessionCookieName,
        maxAge: STATE_TTL_SECONDS,
      });
      response.cookies.set(sessionCookieName, sessionJwt, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecure,
        path: '/api/gmail',
        maxAge: STATE_TTL_SECONDS,
      });
    }
  }

  return response;
}
