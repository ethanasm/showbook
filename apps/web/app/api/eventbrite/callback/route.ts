import { NextRequest, NextResponse } from 'next/server';
import { child } from '@showbook/observability';
import { auth } from '@/auth';

const logger = child({ component: 'web.eventbrite.callback' });
const STATE_COOKIE = 'eventbrite_oauth_state';

function escapeForScript(value: string): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

function clearStateCookie(response: NextResponse, isSecure: boolean): NextResponse {
  response.cookies.set(STATE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/api/eventbrite',
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
        event: 'eventbrite.callback.state_mismatch',
        userId: session.user.id,
        hasCode: !!code,
        hasState: !!state,
        hasExpected: !!expectedState,
      },
      'Eventbrite callback rejected: state mismatch',
    );
    return clearStateCookie(
      new NextResponse(
        '<html><body><script>window.close();</script></body></html>',
        { headers: { 'Content-Type': 'text/html' } },
      ),
      isSecure,
    );
  }

  const clientId = process.env.EVENTBRITE_CLIENT_ID;
  const clientSecret = process.env.EVENTBRITE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return clearStateCookie(
      new NextResponse('Eventbrite import is not configured.', { status: 503 }),
      isSecure,
    );
  }

  const tokenRes = await fetch('https://www.eventbrite.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${baseUrl}/api/eventbrite/callback`,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    logger.warn(
      { event: 'eventbrite.callback.token_exchange_failed', status: tokenRes.status, body: errBody.slice(0, 500) },
      'Eventbrite token exchange failed',
    );
    return clearStateCookie(
      new NextResponse(
        `<html><body><p>Token exchange failed.</p><script>
        if (window.opener) {
          window.opener.postMessage({type:"eventbrite-auth-error"}, window.location.origin);
          setTimeout(function() { window.close(); }, 500);
        }
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
      `<html><body><p>Authenticated. This window will close.</p><script>
      try {
        if (window.opener) {
          window.opener.postMessage({type:"eventbrite-auth",accessToken:${accessToken}}, window.location.origin);
          setTimeout(function() { window.close(); }, 500);
        } else {
          document.body.innerText = "Popup lost connection to parent window.";
        }
      } catch(e) {
        document.body.innerText = "Error: " + e.message;
      }
    </script></body></html>`,
      { headers: { 'Content-Type': 'text/html' } },
    ),
    isSecure,
  );
}
