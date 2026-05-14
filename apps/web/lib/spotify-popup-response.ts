import { NextResponse } from 'next/server';

const STATE_COOKIE = 'spotify_oauth_state';

// Closed set of error reasons broadcast to the parent tab. Anything coming
// from a URL param (notably Spotify's `?error=...` callback param) MUST be
// mapped through `coerceReason` before reaching the popup HTML so that user
// input never flows into the `<script>` block — even encoded as JSON.
export const POPUP_ERROR_REASONS = [
  'access_denied',
  'session_missing',
  'state_mismatch',
  'token_exchange_failed',
  'network',
  'misconfigured',
  'unknown',
] as const;
export type PopupErrorReason = (typeof POPUP_ERROR_REASONS)[number];

const REASON_SET = new Set<string>(POPUP_ERROR_REASONS);

export function coerceReason(raw: string | null | undefined): PopupErrorReason {
  if (raw && REASON_SET.has(raw)) return raw as PopupErrorReason;
  return 'unknown';
}

export type PopupPayload =
  // `spotify-connected` is the connect-once success payload — the
  // OAuth callback persists the access + refresh tokens server-side
  // and signals the parent tab without ever exposing them to the
  // browser. The legacy `spotify-auth` shape (which carried the raw
  // access token) is kept in the union so any in-flight popup that
  // started against an older callback build still parses cleanly on
  // the consuming side.
  | { type: 'spotify-connected' }
  | { type: 'spotify-auth'; accessToken: string }
  | { type: 'spotify-auth-error'; reason: PopupErrorReason };

// Encode a JSON value for safe inlining inside a <script> block. Beyond
// `JSON.stringify`'s defaults we additionally escape the four characters
// that can break out of (or interact dangerously with) the surrounding
// HTML+script context: `<`, `>`, `&`, plus the U+2028 / U+2029 line
// separators that JSON spec doesn't require to be escaped but JS treats
// as line terminators inside string literals.
function encodeForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => {
    return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

// HTML-escape a value before interpolating into element body content.
// Only the four characters with structural meaning in HTML body context:
// `&` MUST be first to avoid double-escaping the others' entities.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build an HTML response body for the OAuth popup window. The popup script
 * always broadcasts the payload to the originating tab via TWO channels:
 *
 *   1. localStorage (`showbook:spotify-auth`) — the storage event fires in
 *      the originating tab even when `window.opener` is null. Mobile Safari
 *      typically loses the opener after the cross-origin Spotify hop, so
 *      this is the only channel that survives there.
 *   2. postMessage to `window.opener` — desktop browsers' primary channel.
 *
 * The popup then attempts to close itself; iOS Safari ignores `window.close`
 * for tabs the user navigated to (vs ones triggered by `window.open`), so we
 * also render a visible message so the tab isn't blank if it can't close.
 */
function buildPopupHtml(payload: PopupPayload, message: string): string {
  const encoded = encodeForScript(payload);
  const safeMessage = escapeHtml(message);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Showbook · Spotify</title></head><body style="font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#111;background:#fafafa;text-align:center"><p style="font-size:14px;line-height:1.5">${safeMessage}</p><script>
(function(){
  var payload = ${encoded};
  try { window.localStorage.setItem("showbook:spotify-auth", JSON.stringify(Object.assign({}, payload, { at: Date.now() }))); } catch (e) {}
  try { if (window.opener) { window.opener.postMessage(payload, window.location.origin); } } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch (e) {} }, 400);
})();
</script></body></html>`;
}

interface PopupResponseOptions {
  payload: PopupPayload;
  message: string;
  status?: number;
  isSecure: boolean;
  /** Whether to clear the OAuth state cookie. Defaults to true. */
  clearState?: boolean;
}

export function popupResponse({
  payload,
  message,
  status = 200,
  isSecure,
  clearState = true,
}: PopupResponseOptions): NextResponse {
  const response = new NextResponse(buildPopupHtml(payload, message), {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
  if (clearState) {
    response.cookies.set(STATE_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/api/spotify',
      maxAge: 0,
    });
  }
  return response;
}
