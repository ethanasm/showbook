import { NextResponse } from 'next/server';

const STATE_COOKIE = 'spotify_oauth_state';

// Backslash-escape any '</' in a JSON-encoded value so the embedded literal
// can't break out of the surrounding <script> tag.
function escapeForScript(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

export type PopupPayload =
  | { type: 'spotify-auth'; accessToken: string }
  | { type: 'spotify-auth-error'; reason: string };

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
  const encoded = escapeForScript(payload);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Showbook · Spotify</title></head><body style="font-family:system-ui,-apple-system,sans-serif;padding:24px;color:#111;background:#fafafa;text-align:center"><p style="font-size:14px;line-height:1.5">${message}</p><script>
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
