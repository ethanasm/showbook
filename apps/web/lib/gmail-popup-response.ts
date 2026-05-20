import { NextResponse } from 'next/server';

const STATE_COOKIE = 'gmail_oauth_state';

// Mobile OAuth handoff. When the mobile app opens the connect flow via
// `expo-web-browser`'s `openAuthSessionAsync`, it appends `?mode=mobile`
// to `/api/gmail`. We echo that fact in a short-lived cookie so the
// callback knows to emit a `showbook://gmail/connected` redirect (which
// the OS-level auth session intercepts and dismisses) instead of the
// postMessage popup HTML used by the web flow.
export const OAUTH_MODE_COOKIE = 'gmail_oauth_mode';
export const OAUTH_MODE_MOBILE = 'mobile';
export type OAuthMode = 'web' | 'mobile';

// `showbook://` is declared as the app scheme in `apps/mobile/app.config.ts`.
// `ASWebAuthenticationSession` (iOS) and Chrome Custom Tabs (Android)
// intercept this URL as the OAuth completion and never expose it to
// any other app on the device — so passing the short-lived (1h) access
// token through the URL is safe in the mobile auth-session sandbox.
export const MOBILE_REDIRECT_BASE = 'showbook://gmail/connected';

export const MOBILE_ERROR_REASONS = [
  'access_denied',
  'session_missing',
  'state_mismatch',
  'token_exchange_failed',
  'misconfigured',
  'unknown',
] as const;
export type MobileErrorReason = (typeof MOBILE_ERROR_REASONS)[number];

export type MobileSuccess = { type: 'success'; accessToken: string };
export type MobileError = { type: 'error'; reason: MobileErrorReason };
export type MobilePayload = MobileSuccess | MobileError;

interface MobileRedirectOptions {
  payload: MobilePayload;
  isSecure: boolean;
  /** Whether to clear the OAuth state + mode cookies. Defaults to true. */
  clearState?: boolean;
}

/**
 * Emit a 302 with a `Location: showbook://gmail/connected?…` URL that the
 * running app session intercepts as the OAuth completion. Constructed by
 * hand because `NextResponse.redirect` / `new URL` reject custom schemes
 * in some runtimes — we need the `Location` header to land verbatim.
 */
export function mobileRedirectResponse({
  payload,
  isSecure,
  clearState = true,
}: MobileRedirectOptions): NextResponse {
  const params = new URLSearchParams();
  if (payload.type === 'success') {
    params.set('status', 'ok');
    params.set('accessToken', payload.accessToken);
  } else {
    params.set('status', 'error');
    params.set('reason', payload.reason);
  }
  const location = `${MOBILE_REDIRECT_BASE}?${params.toString()}`;
  const response = new NextResponse(null, {
    status: 302,
    headers: { Location: location },
  });
  if (clearState) {
    clearAuthCookies(response, isSecure);
  }
  return response;
}

export function clearAuthCookies(response: NextResponse, isSecure: boolean): void {
  for (const name of [STATE_COOKIE, OAUTH_MODE_COOKIE]) {
    response.cookies.set(name, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/api/gmail',
      maxAge: 0,
    });
  }
}
