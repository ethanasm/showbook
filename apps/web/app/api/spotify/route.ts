import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { SPOTIFY_SCOPE_STRING } from '@showbook/api';
import { child } from '@showbook/observability';
import { auth } from '@/auth';

const STATE_COOKIE = 'spotify_oauth_state';
const STATE_TTL_SECONDS = 600;

const log = child({ component: 'web.spotify.authorize', provider: 'spotify' });

export async function GET() {
  // Require an authenticated Showbook session before kicking off the OAuth
  // flow, and bind the flow to that session via a `state` cookie verified in
  // /api/spotify/callback (RFC 6749 §10.12).
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? '';
  const isSecure = baseUrl.startsWith('https');
  const state = randomBytes(32).toString('base64url');

  // Connect-once: every Spotify-using feature in setlist intelligence is
  // batched into a single OAuth dialog upfront, so the user grants every
  // scope they'll ever need on first connect. See
  // showbook-specs/setlist-intelligence/implementation.md §2.
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    redirect_uri: `${baseUrl}/api/spotify/callback`,
    response_type: 'code',
    scope: SPOTIFY_SCOPE_STRING,
    state,
    show_dialog: 'true',
  });
  log.info(
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
