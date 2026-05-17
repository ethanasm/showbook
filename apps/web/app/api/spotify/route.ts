import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { SPOTIFY_SCOPE_STRING } from '@showbook/api';
import { child } from '@showbook/observability';
import { auth } from '@/auth';
import {
  mobileRedirectResponse,
  OAUTH_MODE_COOKIE,
  OAUTH_MODE_MOBILE,
  popupResponse,
  type OAuthMode,
  type PopupPayload,
} from '@/lib/spotify-popup-response';

const logger = child({ component: 'web.spotify.authorize', provider: 'spotify' });
const STATE_COOKIE = 'spotify_oauth_state';
const STATE_TTL_SECONDS = 600;

export async function GET(req: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL ?? '';
  const isSecure = baseUrl.startsWith('https');

  // Mobile opens the OAuth flow in `WebBrowser.openAuthSessionAsync`
  // and detects dismissal by URL match. To hand control back to the
  // app cleanly (and so we can guarantee the server has finished
  // persisting the token before the sheet closes), the callback
  // serves a `Location: showbook://spotify/connected` redirect on
  // mobile instead of the popup HTML. The opt-in is a `?mode=mobile`
  // query param on this route — we then echo it via a cookie so the
  // callback knows which response shape to emit.
  const modeParam = req.nextUrl.searchParams.get('mode');
  const mode: OAuthMode = modeParam === OAUTH_MODE_MOBILE ? OAUTH_MODE_MOBILE : 'web';

  // Early-failure responder. The state + mode cookies haven't been set
  // yet, so `clearState: false` keeps any stale cookies in place for
  // the caller's next attempt. Mobile callers still need a 302 to
  // `showbook://` so the `WebBrowser.openAuthSessionAsync` sheet
  // dismisses — emitting the popup HTML would leave the sheet open.
  const earlyError = (
    payload: PopupPayload,
    options: { message: string; status?: number },
  ) => {
    if (mode === OAUTH_MODE_MOBILE) {
      return mobileRedirectResponse({ payload, isSecure, clearState: false });
    }
    return popupResponse({
      payload,
      message: options.message,
      status: options.status,
      isSecure,
      clearState: false,
    });
  };

  // Require an authenticated Showbook session before kicking off the OAuth
  // flow, and bind the flow to that session via a `state` cookie verified in
  // /api/spotify/callback (RFC 6749 §10.12). If the session is missing,
  // surface a clear error to the caller — popup for web, deep-link redirect
  // for mobile — so the connect sheet unsticks instead of returning raw
  // 'Unauthorized'.
  const session = await auth();
  if (!session?.user?.id) {
    logger.warn(
      { event: 'spotify.authorize.session_missing', mode },
      'Spotify connect popup opened without a Showbook session',
    );
    return earlyError(
      { type: 'spotify-auth-error', reason: 'session_missing' },
      {
        message:
          'Your Showbook session was lost. Please sign in again and retry.',
        status: 401,
      },
    );
  }

  if (!process.env.SPOTIFY_CLIENT_ID) {
    logger.error(
      { event: 'spotify.authorize.client_id_missing', userId: session.user.id, mode },
      'SPOTIFY_CLIENT_ID is not set in this environment',
    );
    return earlyError(
      { type: 'spotify-auth-error', reason: 'misconfigured' },
      {
        message: 'Spotify import is not configured on this server.',
        status: 500,
      },
    );
  }

  const state = randomBytes(32).toString('base64url');

  // Connect-once: every Spotify-using feature in setlist intelligence is
  // batched into a single OAuth dialog upfront, so the user grants every
  // scope they'll ever need on first connect. See
  // specs/setlist-intelligence/implementation.md §2.
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    redirect_uri: `${baseUrl}/api/spotify/callback`,
    response_type: 'code',
    scope: SPOTIFY_SCOPE_STRING,
    state,
    show_dialog: 'true',
  });

  logger.info(
    {
      event: 'spotify.connect.started',
      userId: session.user.id,
      scopes: SPOTIFY_SCOPE_STRING.split(' ').length,
    },
    'Spotify OAuth started',
  );

  const response = NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params}`,
  );

  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/api/spotify',
    maxAge: STATE_TTL_SECONDS,
  });

  // Same `httpOnly` / `lax` / `secure` / scoped-path posture as the
  // state cookie. Only set when the request explicitly opted in to
  // the mobile flow; the absence of this cookie at the callback
  // means "web popup, emit HTML."
  if (mode === OAUTH_MODE_MOBILE) {
    response.cookies.set(OAUTH_MODE_COOKIE, OAUTH_MODE_MOBILE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/api/spotify',
      maxAge: STATE_TTL_SECONDS,
    });
  }

  return response;
}
