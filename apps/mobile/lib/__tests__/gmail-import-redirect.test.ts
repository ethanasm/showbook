/**
 * Unit tests for `parseGmailRedirect` + `describeGmailRedirectError`.
 *
 * The OAuth callback hands back a custom-scheme URL like
 * `showbook://gmail/connected?status=ok&accessToken=…`. These helpers
 * are the only thing standing between that URL and the scan call, so
 * they need to be airtight about malformed input.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGmailOAuthStartUrl,
  describeGmailRedirectError,
  parseGmailRedirect,
} from '../gmail-import/redirect';

describe('parseGmailRedirect', () => {
  it('returns the access token on a success URL', () => {
    const result = parseGmailRedirect(
      'showbook://gmail/connected?status=ok&accessToken=ya29.abc',
    );
    assert.deepEqual(result, { status: 'ok', accessToken: 'ya29.abc' });
  });

  it('preserves URL-encoded tokens', () => {
    const result = parseGmailRedirect(
      'showbook://gmail/connected?status=ok&accessToken=ya29.abc%2Bdef',
    );
    assert.equal(
      (result as { status: 'ok'; accessToken: string }).accessToken,
      'ya29.abc+def',
    );
  });

  it('returns an error result when status=error', () => {
    const result = parseGmailRedirect(
      'showbook://gmail/connected?status=error&reason=state_mismatch',
    );
    assert.deepEqual(result, {
      status: 'error',
      reason: 'state_mismatch',
    });
  });

  it('defaults error reason to "unknown" when omitted', () => {
    const result = parseGmailRedirect(
      'showbook://gmail/connected?status=error',
    );
    assert.deepEqual(result, { status: 'error', reason: 'unknown' });
  });

  it('flags missing access token as an error', () => {
    const result = parseGmailRedirect('showbook://gmail/connected?status=ok');
    assert.deepEqual(result, { status: 'error', reason: 'missing_token' });
  });

  it('returns null when there is no query string at all', () => {
    assert.equal(parseGmailRedirect('showbook://gmail/connected'), null);
  });

  it('returns null when status is unrecognised', () => {
    assert.equal(
      parseGmailRedirect('showbook://gmail/connected?status=wat'),
      null,
    );
  });
});

describe('buildGmailOAuthStartUrl', () => {
  it('appends the bearer token so the server can identify the caller', () => {
    const url = buildGmailOAuthStartUrl('https://api.example.com', 'jwt.abc');
    assert.equal(
      url,
      'https://api.example.com/api/gmail?mode=mobile&token=jwt.abc',
    );
  });

  it('URL-encodes the bearer token', () => {
    const url = buildGmailOAuthStartUrl('https://api.example.com', 'a+b/c=d');
    assert.match(url, /token=a%2Bb%2Fc%3Dd/);
  });

  it('omits the token param when no bearer is provided', () => {
    const url = buildGmailOAuthStartUrl('https://api.example.com', null);
    assert.equal(url, 'https://api.example.com/api/gmail?mode=mobile');
  });

  it('strips trailing slashes from the API URL', () => {
    const url = buildGmailOAuthStartUrl('https://api.example.com//', 'jwt.abc');
    assert.equal(
      url,
      'https://api.example.com/api/gmail?mode=mobile&token=jwt.abc',
    );
  });
});

describe('describeGmailRedirectError', () => {
  it('maps known reasons to human-readable strings', () => {
    assert.match(describeGmailRedirectError('session_missing'), /sign in/i);
    assert.match(describeGmailRedirectError('state_mismatch'), /state mismatch/i);
    assert.match(describeGmailRedirectError('token_exchange_failed'), /token/i);
    assert.match(describeGmailRedirectError('access_denied'), /denied/i);
    assert.match(describeGmailRedirectError('misconfigured'), /not configured/i);
    assert.match(describeGmailRedirectError('missing_token'), /token/i);
  });

  it('falls back for unknown reasons', () => {
    assert.match(describeGmailRedirectError('???'), /failed|try again/i);
  });
});
