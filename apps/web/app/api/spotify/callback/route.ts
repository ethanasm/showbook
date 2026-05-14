import { NextRequest } from 'next/server';
import { child } from '@showbook/observability';
import {
  exchangeAuthorizationCode,
  getCurrentUser,
  persistInitialToken,
  SpotifyError,
} from '@showbook/api';
import { auth } from '@/auth';
import { popupResponse, coerceReason } from '@/lib/spotify-popup-response';

const logger = child({ component: 'web.spotify.callback', provider: 'spotify' });
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
        event: 'spotify.connect.failed',
        reason: errorParam,
      },
      'Spotify OAuth denied or rejected by Spotify',
    );
    return popupResponse({
      // Map Spotify's free-form `error` param through a fixed whitelist
      // before it reaches the popup HTML — never let URL-derived strings
      // flow into the inline <script> payload.
      payload: { type: 'spotify-auth-error', reason: coerceReason(errorParam) },
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
        event: 'spotify.connect.failed',
        reason: 'state_mismatch',
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
      { event: 'spotify.connect.failed', reason: 'session_missing' },
      'Spotify callback hit without a Showbook session',
    );
    return popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'session_missing' },
      message:
        'Your Showbook session was lost during the Spotify hop. Please sign in again and retry.',
      isSecure,
    });
  }

  // Connect-once: exchange code → tokens → /me → persist row, all
  // server-side, so the popup never has to hand a raw access token back
  // to the parent tab. On any failure here, the popup signals
  // `spotify-auth-error` with a typed reason; the picker hook maps that
  // to user-facing copy.
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
    if (err instanceof SpotifyError) {
      // SpotifyError carries an HTTP status. Status `0` is our
      // "didn't reach Spotify" sentinel (env-config issue) — surface
      // as `network`. Anything else means Spotify itself rejected
      // the request — surface as `token_exchange_failed`. Both copies
      // tell the user how to recover.
      const reason = err.status === 0 ? 'network' : 'token_exchange_failed';
      logger.warn(
        {
          err,
          event: 'spotify.connect.failed',
          reason,
          status: err.status,
          userId: session.user.id,
        },
        'Spotify token exchange failed',
      );
      return popupResponse({
        payload: { type: 'spotify-auth-error', reason },
        message:
          reason === 'network'
            ? "Couldn't reach Spotify. Please try again."
            : 'Spotify token exchange failed. You can close this window.',
        isSecure,
      });
    }
    logger.error(
      {
        err,
        event: 'spotify.connect.failed',
        reason: 'token_exchange_or_persist',
        userId: session.user.id,
      },
      'Spotify token exchange / persistence failed',
    );
    return popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'unknown' },
      message: 'Spotify connection failed. You can close this window.',
      isSecure,
    });
  }

  // Note: `persistInitialToken` emits the `spotify.connect.success`
  // event itself, so we don't double-log here.
  return popupResponse({
    payload: { type: 'spotify-connected' },
    message: 'Connected to Spotify. You can close this window.',
    isSecure,
  });
}
