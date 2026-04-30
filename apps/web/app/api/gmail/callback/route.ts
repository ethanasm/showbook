import { NextRequest, NextResponse } from 'next/server';
import { child } from '@showbook/observability';

const logger = child({ component: 'web.gmail.callback' });

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');

  if (!code) {
    return new NextResponse(
      '<html><body><script>window.close();</script></body></html>',
      { headers: { 'Content-Type': 'text/html' } },
    );
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/gmail/callback`,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!tokenRes.ok) {
    // Don't echo Google's response body into HTML — it can contain hostile
    // content and embeds in a <pre> that would interpret </pre><script>… as
    // markup. The popup just signals failure to the opener; details are
    // logged server-side.
    const errBody = await tokenRes.text();
    logger.warn(
      { event: 'gmail.callback.token_exchange_failed', status: tokenRes.status, body: errBody.slice(0, 500) },
      'Gmail token exchange failed',
    );
    return new NextResponse(
      `<html><body><p>Token exchange failed.</p><script>
        if (window.opener) {
          window.opener.postMessage({type:"gmail-auth-error"}, window.location.origin);
          setTimeout(function() { window.close(); }, 500);
        }
      </script></body></html>`,
      { headers: { 'Content-Type': 'text/html' } },
    );
  }

  const tokens = (await tokenRes.json()) as { access_token: string };
  const accessToken = JSON.stringify(tokens.access_token);

  return new NextResponse(
    `<html><body><p>Authenticated. This window will close.</p><script>
      try {
        if (window.opener) {
          window.opener.postMessage({type:"gmail-auth",accessToken:${accessToken}}, window.location.origin);
          setTimeout(function() { window.close(); }, 500);
        } else {
          document.body.innerText = "Popup lost connection to parent window. Copy this token and paste it: " + ${accessToken};
        }
      } catch(e) {
        document.body.innerText = "Error: " + e.message;
      }
    </script></body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
  );
}
