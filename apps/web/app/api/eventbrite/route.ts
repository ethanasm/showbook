import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { auth } from '@/auth';

const STATE_COOKIE = 'eventbrite_oauth_state';
const STATE_TTL_SECONDS = 600;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const clientId = process.env.EVENTBRITE_CLIENT_ID;
  if (!clientId) {
    return new NextResponse(
      'Eventbrite import is not configured (EVENTBRITE_CLIENT_ID missing).',
      { status: 503 },
    );
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? '';
  const isSecure = baseUrl.startsWith('https');
  const state = randomBytes(32).toString('base64url');

  // Eventbrite OAuth scopes are not granular: a token can read everything the
  // user can see, including past orders. The redirect URI must be whitelisted
  // exactly in the Eventbrite app's OAuth settings.
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `${baseUrl}/api/eventbrite/callback`,
    state,
  });

  const response = NextResponse.redirect(
    `https://www.eventbrite.com/oauth/authorize?${params}`,
  );

  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/api/eventbrite',
    maxAge: STATE_TTL_SECONDS,
  });

  return response;
}
