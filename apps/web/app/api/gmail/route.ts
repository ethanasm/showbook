import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { auth } from '@/auth';

const STATE_COOKIE = 'gmail_oauth_state';
const STATE_TTL_SECONDS = 600;

export async function GET() {
  // Require an authenticated Showbook session before kicking off the OAuth
  // flow, and bind the flow to that session via a `state` cookie verified in
  // /api/gmail/callback (RFC 6749 §10.12).
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? '';
  const isSecure = baseUrl.startsWith('https');
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

  return response;
}
