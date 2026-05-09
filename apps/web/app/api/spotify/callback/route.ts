import { NextRequest } from 'next/server';
import { child } from '@showbook/observability';
import { auth } from '@/auth';
import { popupResponse } from '@/lib/spotify-popup-response';

const logger = child({ component: 'web.spotify.callback' });
const STATE_COOKIE = 'spotify_oauth_state';

export async function GET(req: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL ?? '';
  const isSecure = baseUrl.startsWith('https');

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const errorParam = req.nextUrl.searchParams.get('error');
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;

  // Spotify follows OAuth 2.0: when the user denies consent (or Spotify
  // itself rejects the request), we get back `?error=...&state=...` with no
  // `code`. Treat this as the normal "user canceled" case and broadcast a
  // friendly error so the parent tab unsticks. Without the broadcast the
  // popup just closes silently and the picker hook hangs.
  if (errorParam) {
    logger.info(
      {
        event: 'spotify.callback.user_denied',
        reason: errorParam,
      },
      'Spotify OAuth denied or rejected by Spotify',
    );
    return popupResponse({
      payload: { type: 'spotify-auth-error', reason: errorParam },
      message:
        errorParam === 'access_denied'
          ? 'Spotify connection canceled. You can close this window.'
          : 'Spotify rejected the request. You can close this window.',
      isSecure,
    });
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    logger.warn(
      {
        event: 'spotify.callback.state_mismatch',
        hasCode: !!code,
        hasState: !!state,
        hasExpected: !!expectedState,
      },
      'Spotify callback rejected: state mismatch',
    );
    return popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'state_mismatch' },
      message: 'Spotify connection failed (state mismatch). Please try again.',
      isSecure,
    });
  }

  // The state cookie is the security boundary — we only get here if the
  // browser presented the same random nonce we issued at /api/spotify.
  // Re-check the Showbook session for defense in depth, but if it's gone
  // (iOS Safari ITP can drop the session cookie across the cross-origin
  // hop), still surface a clear error to the parent rather than returning
  // raw 'Unauthorized' text in the popup.
  const session = await auth();
  if (!session?.user?.id) {
    logger.warn(
      { event: 'spotify.callback.session_missing' },
      'Spotify callback hit without a Showbook session',
    );
    return popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'session_missing' },
      message:
        'Your Showbook session was lost during the Spotify hop. Please sign in again and retry.',
      isSecure,
    });
  }

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`,
  ).toString('base64');

  let tokenRes: Response;
  try {
    tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        code,
        redirect_uri: `${baseUrl}/api/spotify/callback`,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.error(
      { err, event: 'spotify.callback.token_exchange_network' },
      'Spotify token exchange threw',
    );
    return popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'network' },
      message: "Couldn't reach Spotify. Please try again.",
      isSecure,
    });
  }

  if (!tokenRes.ok) {
    // Don't echo Spotify's response body into HTML — it can contain hostile
    // content. The popup just signals failure to the opener; details are
    // logged server-side.
    const errBody = await tokenRes.text();
    logger.warn(
      {
        event: 'spotify.callback.token_exchange_failed',
        userId: session.user.id,
        status: tokenRes.status,
        body: errBody.slice(0, 500),
      },
      'Spotify token exchange failed',
    );
    return popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'token_exchange_failed' },
      message: 'Spotify token exchange failed. You can close this window.',
      isSecure,
    });
  }

  const tokens = (await tokenRes.json()) as { access_token: string };
  logger.info(
    {
      event: 'spotify.callback.success',
      userId: session.user.id,
    },
    'Spotify OAuth completed',
  );
  return popupResponse({
    payload: { type: 'spotify-auth', accessToken: tokens.access_token },
    message: 'Connected to Spotify. You can close this window.',
    isSecure,
  });
}
