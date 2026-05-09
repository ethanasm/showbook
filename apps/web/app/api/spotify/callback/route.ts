import { NextRequest, NextResponse } from 'next/server';
import { child } from '@showbook/observability';
import {
  exchangeAuthorizationCode,
  getCurrentUser,
  persistInitialToken,
  SpotifyError,
} from '@showbook/api';
import { auth } from '@/auth';

const logger = child({ component: 'web.spotify.callback', provider: 'spotify' });
const STATE_COOKIE = 'spotify_oauth_state';

function clearStateCookie(response: NextResponse, isSecure: boolean): NextResponse {
  response.cookies.set(STATE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/api/spotify',
    maxAge: 0,
  });
  return response;
}

/**
 * Browser-side glue for the popup.
 *
 * Connect-once flow: the access token is persisted server-side before the
 * popup ever closes, so the message we post to the opener carries
 * `spotify-connected` (no token). The opener invalidates
 * `spotify.connectionStatus` and resumes whatever action triggered the
 * popup. Mobile Safari nulls out `window.opener` after the cross-origin
 * Spotify hop, so we *also* broadcast via localStorage — the originating
 * tab listens for the `storage` event.
 *
 * Body never contains user data — just status flags. That keeps the
 * inline `<script>` literal safe even though the document is generated
 * server-side.
 */
function popupHtml(payload: 'spotify-connected' | 'spotify-auth-error'): string {
  const message = JSON.stringify({ type: payload, at: Date.now() });
  return `<!doctype html><html><body><p>${
    payload === 'spotify-connected'
      ? 'Connected. You can close this window and return to Showbook.'
      : 'Spotify connection failed. You can close this window and try again.'
  }</p><script>
    try {
      try {
        // Same-origin localStorage broadcast — the storage event fires in
        // the originating tab even when window.opener is null.
        window.localStorage.setItem("showbook:spotify-auth", ${JSON.stringify(message)});
      } catch (e) {}
      try {
        if (window.opener) {
          window.opener.postMessage(${message}, window.location.origin);
        }
      } catch (e) {}
      setTimeout(function () { try { window.close(); } catch (e) {} }, 500);
    } catch (e) {
      document.body.innerText = "Error: " + e.message;
    }
  </script></body></html>`;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? '';
  const isSecure = baseUrl.startsWith('https');

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    logger.warn(
      {
        event: 'spotify.connect.failed',
        reason: 'state_mismatch',
        userId: session.user.id,
        hasCode: !!code,
        hasState: !!state,
        hasExpected: !!expectedState,
      },
      'Spotify callback rejected: state mismatch',
    );
    return clearStateCookie(
      new NextResponse(popupHtml('spotify-auth-error'), {
        headers: { 'Content-Type': 'text/html' },
      }),
      isSecure,
    );
  }

  // Exchange code → tokens → /me → persist row. Each hop has its own
  // failure mode; we surface a generic "auth-error" to the popup but
  // log specifics.
  try {
    const tokens = await exchangeAuthorizationCode({
      code,
      redirectUri: `${baseUrl}/api/spotify/callback`,
    });
    const profile = await getCurrentUser(tokens.accessToken);
    await persistInitialToken({
      userId: session.user.id,
      tokens,
      profile,
    });
  } catch (err) {
    const status = err instanceof SpotifyError ? err.status : 0;
    logger.error(
      {
        err,
        event: 'spotify.connect.failed',
        reason: 'token_exchange_or_persist',
        status,
        userId: session.user.id,
      },
      'Spotify token exchange / persistence failed',
    );
    return clearStateCookie(
      new NextResponse(popupHtml('spotify-auth-error'), {
        headers: { 'Content-Type': 'text/html' },
      }),
      isSecure,
    );
  }

  return clearStateCookie(
    new NextResponse(popupHtml('spotify-connected'), {
      headers: { 'Content-Type': 'text/html' },
    }),
    isSecure,
  );
}
