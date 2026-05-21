/**
 * Pure helpers for parsing the `showbook://gmail/connected?…` redirect
 * URL emitted by `/api/gmail/callback`. Kept separate from the React
 * hook so we can unit-test the URL-parsing edge cases (malformed URLs,
 * missing params, error reasons) without spinning up `expo-web-browser`.
 */

export const MOBILE_REDIRECT_SCHEME = 'showbook://gmail/connected';

/**
 * Build the OAuth start URL the mobile app hands to
 * `WebBrowser.openAuthSessionAsync`. The bearer JWT is passed via query
 * param because the auth-session browser sandbox has no Showbook cookie
 * jar and `openAuthSessionAsync` cannot set custom headers. The token
 * only travels to our own origin over HTTPS within that sandbox; the
 * subsequent Google redirect doesn't include it.
 */
export function buildGmailOAuthStartUrl(
  apiUrl: string,
  bearerToken: string | null,
): string {
  const base = `${apiUrl.replace(/\/+$/, '')}/api/gmail`;
  const params = new URLSearchParams({ mode: 'mobile' });
  if (bearerToken) params.set('token', bearerToken);
  return `${base}?${params.toString()}`;
}

export type GmailRedirectResult =
  | { status: 'ok'; accessToken: string }
  | { status: 'error'; reason: string };

/**
 * Parse the URL returned by `WebBrowser.openAuthSessionAsync`. Tolerates
 * the fact that some platforms hand back the URL with a trailing slash
 * before the query string and that the URL constructor in older RN
 * builds can choke on custom schemes — we fall back to a regex split.
 */
export function parseGmailRedirect(url: string): GmailRedirectResult | null {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return null;
  const query = url.slice(queryStart + 1);
  const params = new URLSearchParams(query);
  const status = params.get('status');
  if (status === 'ok') {
    const accessToken = params.get('accessToken');
    // Treat the literal strings 'undefined' / 'null' as missing — the
    // server should never send those, but `URLSearchParams.set(key, x)`
    // happily stringifies `undefined`/`null` if the caller forgets to
    // validate, and a bad token from us would surface to the user as
    // an inscrutable Gmail-side 401.
    if (!accessToken || accessToken === 'undefined' || accessToken === 'null') {
      return { status: 'error', reason: 'missing_token' };
    }
    return { status: 'ok', accessToken };
  }
  if (status === 'error') {
    return { status: 'error', reason: params.get('reason') ?? 'unknown' };
  }
  return null;
}

/**
 * Map an opaque server-side reason to a human-readable message. Keep
 * copy in sync with the reason set in
 * `apps/web/lib/gmail-popup-response.ts`.
 */
export function describeGmailRedirectError(reason: string): string {
  switch (reason) {
    case 'access_denied':
      return 'You denied access to Gmail. Try again to grant read-only permission.';
    case 'session_missing':
      return 'Sign in to Showbook in your browser first, then retry.';
    case 'state_mismatch':
      return 'OAuth handshake failed (state mismatch). Retry the connect flow.';
    case 'token_exchange_failed':
      return "Google didn't issue a Gmail token. Try again in a minute.";
    case 'misconfigured':
      return 'Gmail is not configured on this server.';
    case 'missing_token':
      return "Gmail handshake didn't return a usable token. Try again.";
    default:
      return 'Gmail connection failed. Try again.';
  }
}
