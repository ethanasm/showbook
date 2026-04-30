import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isEmailAllowed, parseAllowlist } from '../auth-allowlist';

describe('parseAllowlist', () => {
  it('returns [] for undefined or empty', () => {
    assert.deepEqual(parseAllowlist(undefined), []);
    assert.deepEqual(parseAllowlist(''), []);
    assert.deepEqual(parseAllowlist(' , ,  '), []);
  });

  it('trims whitespace and lowercases', () => {
    assert.deepEqual(
      parseAllowlist(' Foo@Bar.com , BAZ.com '),
      ['foo@bar.com', 'baz.com'],
    );
  });
});

describe('isEmailAllowed', () => {
  it('open mode: both lists empty allows everyone', () => {
    assert.equal(isEmailAllowed('a@b.com', { emails: [], domains: [] }), true);
    assert.equal(isEmailAllowed(null, { emails: [], domains: [] }), true);
    assert.equal(isEmailAllowed(undefined, { emails: [], domains: [] }), true);
  });

  it('rejects when email is missing and any list is set', () => {
    assert.equal(isEmailAllowed(null, { emails: ['a@b.com'], domains: [] }), false);
    assert.equal(isEmailAllowed(undefined, { emails: [], domains: ['b.com'] }), false);
  });

  it('matches an email case-insensitively when paired with parseAllowlist', () => {
    // Inputs to isEmailAllowed are expected to be pre-normalized via parseAllowlist.
    // What actually matters: the user.email side can arrive in any case from Google.
    const opts = { emails: parseAllowlist('Foo@Bar.com'), domains: [] };
    assert.equal(isEmailAllowed('Foo@Bar.com', opts), true);
    assert.equal(isEmailAllowed('foo@bar.com', opts), true);
    assert.equal(isEmailAllowed('FOO@BAR.COM', opts), true);
  });

  it('matches a domain case-insensitively when paired with parseAllowlist', () => {
    const opts = { emails: [], domains: parseAllowlist('ACME.com') };
    assert.equal(isEmailAllowed('alice@acme.com', opts), true);
    assert.equal(isEmailAllowed('alice@ACME.com', opts), true);
  });

  it('does not allow a substring domain match', () => {
    // "acme.com" must not allow "fakeacme.com" or "acme.com.evil.com"
    assert.equal(
      isEmailAllowed('mallory@fakeacme.com', { emails: [], domains: ['acme.com'] }),
      false,
    );
    assert.equal(
      isEmailAllowed('mallory@acme.com.evil.com', { emails: [], domains: ['acme.com'] }),
      false,
    );
  });

  it('rejects emails that match neither list', () => {
    assert.equal(
      isEmailAllowed('mallory@evil.com', {
        emails: ['foo@bar.com'],
        domains: ['acme.com'],
      }),
      false,
    );
  });

  it('allows when only one of the two lists matches', () => {
    assert.equal(
      isEmailAllowed('alice@acme.com', {
        emails: ['someone@else.com'],
        domains: ['acme.com'],
      }),
      true,
    );
    assert.equal(
      isEmailAllowed('foo@bar.com', {
        emails: ['foo@bar.com'],
        domains: ['acme.com'],
      }),
      true,
    );
  });
});
