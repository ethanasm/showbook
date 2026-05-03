import { NextRequest, NextResponse } from 'next/server';
import { child } from '@showbook/observability';
import { auth } from '@/auth';

const logger = child({ component: 'web.spotify.callback' });
const STATE_COOKIE = 'spotify_oauth_state';

// Backslash-escape any '</' in a JSON-encoded value so the embedded literal
// can't break out of the surrounding <script> tag.
function escapeForScript(value: string): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

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
        event: 'spotify.callback.state_mismatch',
        userId: session.user.id,
        hasCode: !!code,
        hasState: !!state,
        hasExpected: !!expectedState,
      },
      'Spotify callback rejected: state mismatch',
    );
    return clearStateCookie(
      new NextResponse(
        '<html><body><script>window.close();</script></body></html>',
        { headers: { 'Content-Type': 'text/html' } },
      ),
      isSecure,
    );
  }

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`,
  ).toString('base64');

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
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

  if (!tokenRes.ok) {
    // Don't echo Spotify's response body into HTML — it can contain hostile
    // content. The popup just signals failure to the opener; details are
    // logged server-side.
    const errBody = await tokenRes.text();
    logger.warn(
      { event: 'spotify.callback.token_exchange_failed', status: tokenRes.status, body: errBody.slice(0, 500) },
      'Spotify token exchange failed',
    );
    return clearStateCookie(
      new NextResponse(
        `<html><body><p>Token exchange failed. You can close this window.</p><script>
        try {
          // Same-origin localStorage broadcast: the storage event fires in the
          // originating tab even when window.opener is null (mobile Safari
          // typically loses the opener after the cross-origin Spotify hop).
          window.localStorage.setItem("showbook:spotify-auth", JSON.stringify({type:"spotify-auth-error",at:Date.now()}));
        } catch (e) {}
        try {
          if (window.opener) {
            window.opener.postMessage({type:"spotify-auth-error"}, window.location.origin);
          }
        } catch (e) {}
        setTimeout(function() { try { window.close(); } catch (e) {} }, 500);
      </script></body></html>`,
        { headers: { 'Content-Type': 'text/html' } },
      ),
      isSecure,
    );
  }

  const tokens = (await tokenRes.json()) as { access_token: string };
  const accessToken = escapeForScript(tokens.access_token);

  return clearStateCookie(
    new NextResponse(
      `<html><body><p>Authenticated. You can close this window and return to Showbook.</p><script>
      try {
        // Same-origin localStorage broadcast: the storage event fires in the
        // originating tab even when window.opener is null (mobile Safari
        // typically loses the opener after the cross-origin Spotify hop).
        try {
          window.localStorage.setItem("showbook:spotify-auth", JSON.stringify({type:"spotify-auth",accessToken:${accessToken},at:Date.now()}));
        } catch (e) {}
        if (window.opener) {
          window.opener.postMessage({type:"spotify-auth",accessToken:${accessToken}}, window.location.origin);
        }
        setTimeout(function() { try { window.close(); } catch (e) {} }, 500);
      } catch(e) {
        document.body.innerText = "Error: " + e.message;
      }
    </script></body></html>`,
      { headers: { 'Content-Type': 'text/html' } },
    ),
    isSecure,
  );
}
