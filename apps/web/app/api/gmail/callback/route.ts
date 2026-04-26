import { NextRequest, NextResponse } from 'next/server';

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
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    return new NextResponse(
      `<html><body><p>Token exchange failed.</p><script>
        if (window.opener) {
          window.opener.postMessage({type:"gmail-auth-error"}, window.location.origin);
          setTimeout(function() { window.close(); }, 500);
        }
      </script><pre>${errBody}</pre></body></html>`,
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
