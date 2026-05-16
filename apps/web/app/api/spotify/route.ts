import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { SPOTIFY_SCOPE_STRING } from '@showbook/api';
import { child } from '@showbook/observability';
import { auth } from '@/auth';
import { popupResponse } from '@/lib/spotify-popup-response';

const logger = child({ component: 'web.spotify.authorize', provider: 'spotify' });
const STATE_COOKIE = 'spotify_oauth_state';
const STATE_TTL_SECONDS = 600;

export async function GET() {
  const baseUrl = process.env.NEXTAUTH_URL ?? '';
  const isSecure = baseUrl.startsWith('https');

  // Require an authenticated Showbook session before kicking off the OAuth
  // flow, and bind the flow to that session via a `state` cookie verified in
  // /api/spotify/callback (RFC 6749 §10.12). If the session is missing,
  // surface a clear error in the popup AND broadcast it to the parent tab
  // so the picker hook unsticks instead of returning raw 'Unauthorized'.
  const session = await auth();
  if (!session?.user?.id) {
    logger.warn(
      { event: 'spotify.authorize.session_missing' },
      'Spotify connect popup opened without a Showbook session',
    );
    return popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'session_missing' },
      message:
        'Your Showbook session was lost. Please sign in again and retry.',
      status: 401,
      isSecure,
      clearState: false,
    });
  }

  if (!process.env.SPOTIFY_CLIENT_ID) {
    logger.error(
      { event: 'spotify.authorize.client_id_missing', userId: session.user.id },
      'SPOTIFY_CLIENT_ID is not set in this environment',
    );
    return popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'misconfigured' },
      message: 'Spotify import is not configured on this server.',
      status: 500,
      isSecure,
      clearState: false,
    });
  }

  const state = randomBytes(32).toString('base64url');

  // Connect-once: every Spotify-using feature in setlist intelligence is
  // batched into a single OAuth dialog upfront, so the user grants every
  // scope they'll ever need on first connect. See
  // showbook-specs/setlist-intelligence/implementation.md §2.
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

  return response;
}
