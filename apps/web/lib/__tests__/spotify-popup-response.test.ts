import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  popupResponse,
  coerceReason,
  POPUP_ERROR_REASONS,
} from '../spotify-popup-response';

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

  it('embeds the payload as a script-safe encoded JSON expression', async () => {
    const res = popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'token_exchange_failed' },
      message: 'Failed.',
      isSecure: true,
    });
    const html = await htmlOf(res);
    // Strings have no `<>&` so they pass through verbatim.
    assert.match(
      html,
      /var payload = \{"type":"spotify-auth-error","reason":"token_exchange_failed"\};/,
    );
  });

  it('encodes < > & in the payload to \\uXXXX so they cannot break out of <script>', async () => {
    // Hostile token from Spotify (or any future source). We don't trust it
    // to be free of HTML/JS metacharacters even though in practice it's
    // base64-ish — the encoding has to hold against anything.
    const res = popupResponse({
      payload: {
        type: 'spotify-auth',
        accessToken: '</script><img src=x onerror=alert(1)>&amp',
      },
      message: 'OK.',
      isSecure: true,
    });
    const html = await htmlOf(res);

    // Exactly one </script> tag — the legitimate closing one for our block.
    const matches = html.match(/<\/script>/g) ?? [];
    assert.equal(matches.length, 1, `Expected exactly one </script>, got ${matches.length}`);

    // The dangerous chars are present only as \\uXXXX inside the payload.
    assert.match(html, /\\u003c/);
    assert.match(html, /\\u003e/);
    assert.match(html, /\\u0026/);
    // No raw `<img` tag should leak into the document.
    assert.doesNotMatch(html, /<img\s/);
  });

  it('encodes U+2028 / U+2029 inside payload strings (JS treats them as line terminators)', async () => {
    const accessToken = 'before after end';
    const res = popupResponse({
      payload: { type: 'spotify-auth', accessToken },
      message: 'OK.',
      isSecure: true,
    });
    const html = await htmlOf(res);
    assert.match(html, /\\u2028/);
    assert.match(html, /\\u2029/);
    // Raw codepoints must not appear in the response body. Use the RegExp
    // constructor here — raw U+2028 / U+2029 are line terminators in JS
    // source and would prematurely end the regex literal at parse time.
    assert.doesNotMatch(html, new RegExp('\u2028'));
    assert.doesNotMatch(html, new RegExp('\u2029'));
  });

  it('HTML-escapes the user-facing message (defense in depth)', async () => {
    const res = popupResponse({
      payload: { type: 'spotify-auth-error', reason: 'state_mismatch' },
      message: 'Hostile <script>alert(1)</script> & "quoted"',
      isSecure: true,
    });
    const html = await htmlOf(res);
    assert.match(html, /Hostile &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quoted&quot;/);
    // The literal payload <script> should not appear inside the <p> tag.
    assert.doesNotMatch(html, /<p[^>]*><script/);
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

describe('coerceReason', () => {
  it('passes through every value in POPUP_ERROR_REASONS', () => {
    for (const r of POPUP_ERROR_REASONS) {
      assert.equal(coerceReason(r), r);
    }
  });

  it('collapses unknown / null / undefined / hostile values to "unknown"', () => {
    assert.equal(coerceReason(null), 'unknown');
    assert.equal(coerceReason(undefined), 'unknown');
    assert.equal(coerceReason(''), 'unknown');
    assert.equal(coerceReason('not_a_real_reason'), 'unknown');
    assert.equal(coerceReason('<script>alert(1)</script>'), 'unknown');
    // The "unknown" sentinel itself is allowed (it's in the whitelist).
    assert.equal(coerceReason('unknown'), 'unknown');
  });
});
