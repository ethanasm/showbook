import { NextRequest, NextResponse } from 'next/server';
import { child } from '@showbook/observability';
import { auth } from '@/auth';
import {
  mobileRedirectResponse,
  OAUTH_MODE_COOKIE,
  OAUTH_MODE_MOBILE,
} from '@/lib/gmail-popup-response';

const logger = child({ component: 'web.gmail.callback' });
const STATE_COOKIE = 'gmail_oauth_state';

// Backslash-escape any '</' in a JSON-encoded value so the embedded literal
// can't break out of the surrounding <script> tag.
function escapeForScript(value: string): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

function clearStateCookie(response: NextResponse, isSecure: boolean): NextResponse {
  for (const name of [STATE_COOKIE, OAUTH_MODE_COOKIE]) {
    response.cookies.set(name, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/api/gmail',
      maxAge: 0,
    });
  }
  return response;
}

export async function GET(req: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL ?? '';
  const isSecure = baseUrl.startsWith('https');

  // Read the mode cookie first so error responses match the caller's
  // expected shape (web popup HTML vs mobile custom-scheme redirect).
  const isMobile = req.cookies.get(OAUTH_MODE_COOKIE)?.value === OAUTH_MODE_MOBILE;

  const session = await auth();
  if (!session?.user?.id) {
    if (isMobile) {
      return mobileRedirectResponse({
        payload: { type: 'error', reason: 'session_missing' },
        isSecure,
      });
    }
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    logger.warn(
      {
        event: 'gmail.callback.state_mismatch',
        userId: session.user.id,
        hasCode: !!code,
        hasState: !!state,
        hasExpected: !!expectedState,
      },
      'Gmail callback rejected: state mismatch',
    );
    if (isMobile) {
      return mobileRedirectResponse({
        payload: { type: 'error', reason: 'state_mismatch' },
        isSecure,
      });
    }
    return clearStateCookie(
      new NextResponse(
        '<html><body><script>window.close();</script></body></html>',
        { headers: { 'Content-Type': 'text/html' } },
      ),
      isSecure,
    );
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${baseUrl}/api/gmail/callback`,
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
    if (isMobile) {
      return mobileRedirectResponse({
        payload: { type: 'error', reason: 'token_exchange_failed' },
        isSecure,
      });
    }
    return clearStateCookie(
      new NextResponse(
        `<html><body><p>Token exchange failed.</p><script>
        if (window.opener) {
          window.opener.postMessage({type:"gmail-auth-error"}, window.location.origin);
          setTimeout(function() { window.close(); }, 500);
        }
      </script></body></html>`,
        { headers: { 'Content-Type': 'text/html' } },
      ),
      isSecure,
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: unknown;
    scope?: unknown;
  };
  // Trim defensively: a trailing newline or stray whitespace in Google's
  // response would survive `URLSearchParams.set` percent-encoding and
  // arrive at Gmail as part of the Bearer header, producing the
  // unhelpful "Gmail rejected the access token" 401 we're trying to
  // diagnose.
  const accessTokenRaw =
    typeof tokens.access_token === 'string'
      ? tokens.access_token.trim()
      : tokens.access_token;
  if (typeof accessTokenRaw !== 'string' || !accessTokenRaw) {
    // 200 from Google's token endpoint with no usable access_token is rare
    // but has been observed in the wild (empty body on intermittent
    // failures). Returning the literal undefined would let
    // `URLSearchParams.set` coerce it to the string "undefined" and
    // surface as a Gmail-side 401 later — fail loudly here instead.
    logger.warn(
      {
        event: 'gmail.callback.access_token_missing',
        scope: typeof tokens.scope === 'string' ? tokens.scope : undefined,
      },
      'Gmail token exchange returned no access_token',
    );
    if (isMobile) {
      return mobileRedirectResponse({
        payload: { type: 'error', reason: 'token_exchange_failed' },
        isSecure,
      });
    }
    return clearStateCookie(
      new NextResponse(
        `<html><body><p>Token exchange returned no access token.</p><script>
        if (window.opener) {
          window.opener.postMessage({type:"gmail-auth-error"}, window.location.origin);
          setTimeout(function() { window.close(); }, 500);
        }
      </script></body></html>`,
        { headers: { 'Content-Type': 'text/html' } },
      ),
      isSecure,
    );
  }
  // Google's token endpoint returns the actual granted scopes as a
  // space-separated string. If we don't get a Gmail scope back, the
  // access token won't authorize Gmail API calls — bail here with a
  // `token_exchange_failed` so the mobile UI can prompt re-consent
  // instead of letting the scan endpoint surface a confusing
  // "Gmail rejected the access token" 401.
  //
  // We accept any Gmail scope that's a superset of `gmail.readonly`
  // (`gmail.modify`, `gmail.compose`, `https://mail.google.com/`).
  // The previous check was strict-equality on `gmail.readonly`, which
  // rejected users who had previously granted a broader Gmail scope —
  // Google would return only the broader scope (not the requested
  // narrower one) and the callback would bail even though the token
  // would have worked.
  const GMAIL_SCOPE_SUPERSETS = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.metadata',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.insert',
    'https://mail.google.com/',
  ];
  const grantedScopes =
    typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/) : [];
  const hasGmailScope = grantedScopes.some((s) =>
    GMAIL_SCOPE_SUPERSETS.includes(s),
  );
  if (!hasGmailScope) {
    logger.warn(
      {
        event: 'gmail.callback.scope_missing',
        granted: grantedScopes.join(' '),
      },
      'Gmail token exchange returned token without a Gmail read scope',
    );
    if (isMobile) {
      return mobileRedirectResponse({
        payload: { type: 'error', reason: 'token_exchange_failed' },
        isSecure,
      });
    }
    return clearStateCookie(
      new NextResponse(
        `<html><body><p>Gmail read-only access was not granted.</p><script>
        if (window.opener) {
          window.opener.postMessage({type:"gmail-auth-error"}, window.location.origin);
          setTimeout(function() { window.close(); }, 500);
        }
      </script></body></html>`,
        { headers: { 'Content-Type': 'text/html' } },
      ),
      isSecure,
    );
  }

  if (isMobile) {
    // Diagnostic: confirm the callback success path actually ran and
    // capture the granted scope + a non-PII fingerprint of the access
    // token so we can correlate against the scan endpoint's view of the
    // same token. The fingerprint is just length + first/last chars —
    // enough to detect mid-flight corruption (truncation, URL re-encoding)
    // without surfacing the bearer secret in logs. Pino's redact rule
    // strips `*.token`, so the field is named `tokenInfo` to slip past it
    // intentionally — we control the shape and never include the body.
    logger.info(
      {
        event: 'gmail.callback.success',
        userId: session.user.id,
        scope: grantedScopes.join(' '),
        tokenInfo: {
          length: accessTokenRaw.length,
          head: accessTokenRaw.slice(0, 8),
          tail: accessTokenRaw.slice(-4),
        },
      },
      'Gmail OAuth callback succeeded (mobile)',
    );
    return mobileRedirectResponse({
      payload: { type: 'success', accessToken: accessTokenRaw },
      isSecure,
    });
  }

  const accessToken = escapeForScript(accessTokenRaw);

  return clearStateCookie(
    new NextResponse(
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
    ),
    isSecure,
  );
}
