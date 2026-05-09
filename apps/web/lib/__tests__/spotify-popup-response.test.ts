import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { popupResponse } from '../spotify-popup-response';

async function htmlOf(res: Response): Promise<string> {
  return await res.text();
}

describe('popupResponse', () => {
  it('returns 200 by default with text/html content-type', async () => {
    const res = popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'state_mismatch' },
      message: 'Failed.',
      isSecure: true,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  });

  it('uses the provided status code', () => {
    const res = popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'session_missing' },
      message: 'Lost session.',
      status: 401,
      isSecure: true,
    });
    assert.equal(res.status, 401);
  });

  it('embeds the payload as JSON inside a script tag', async () => {
    const res = popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'token_exchange_failed' },
      message: 'Failed.',
      isSecure: true,
    });
    const html = await htmlOf(res);
    assert.match(
      html,
      /var payload = \{"type":"spotify-auth-error","reason":"token_exchange_failed"\}/,
    );
  });

  it('escapes </ inside payload to prevent script-tag breakout', async () => {
    const res = popupResponse({
      payload: { type: 'spotify-auth', accessToken: '</script><img src=x>' },
      message: 'OK.',
      isSecure: true,
    });
    const html = await htmlOf(res);
    // The dangerous `</script>` literal must not appear in the payload JSON.
    // It should be backslash-escaped to `<\/script>`.
    const scriptCloseRe = /<\/script>/g;
    const matches = html.match(scriptCloseRe) ?? [];
    // Exactly one occurrence — the legitimate closing tag of our own <script>.
    assert.equal(
      matches.length,
      1,
      `Expected exactly one </script> tag, got ${matches.length}: ${html}`,
    );
    assert.match(html, /<\\\/script>/);
  });

  it('clears the spotify_oauth_state cookie by default', () => {
    const res = popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'state_mismatch' },
      message: 'Failed.',
      isSecure: true,
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /spotify_oauth_state=/);
    assert.match(setCookie, /Max-Age=0/i);
    assert.match(setCookie, /Path=\/api\/spotify/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /HttpOnly/);
  });

  it('skips cookie clear when clearState=false', () => {
    const res = popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'session_missing' },
      message: 'Lost session.',
      isSecure: true,
      clearState: false,
    });
    const setCookie = res.headers.get('set-cookie');
    assert.equal(setCookie, null);
  });

  it('omits Secure attribute when isSecure=false (e.g. http://localhost)', () => {
    const res = popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'state_mismatch' },
      message: 'Failed.',
      isSecure: false,
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.doesNotMatch(setCookie, /Secure/);
  });

  it('renders the user-facing message in the body', async () => {
    const res = popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'state_mismatch' },
      message: 'Spotify connection canceled.',
      isSecure: true,
    });
    const html = await htmlOf(res);
    assert.match(html, /Spotify connection canceled\./);
  });

  it('emits localStorage broadcast and postMessage in the script', async () => {
    const res = popupResponse({
      payload: { type: 'spotify-auth', accessToken: 'tok-123' },
      message: 'Connected.',
      isSecure: true,
    });
    const html = await htmlOf(res);
    assert.match(html, /window\.localStorage\.setItem\("showbook:spotify-auth"/);
    assert.match(html, /window\.opener\.postMessage/);
    assert.match(html, /window\.close\(\)/);
  });
});
