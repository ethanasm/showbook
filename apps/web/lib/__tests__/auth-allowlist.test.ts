import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEmailAllowed,
  parseAllowlist,
  readAllowlistFromEnv,
  shouldAllowSignIn,
} from '../auth-allowlist';

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

describe('shouldAllowSignIn', () => {
  it('rejects when emailVerified is explicitly false, even if the email is on the list', () => {
    // Workspace external aliases / send-as can present any email with
    // email_verified=false. Without this guard the allowlist would accept
    // a spoofed address.
    assert.equal(
      shouldAllowSignIn({
        email: 'alice@acme.com',
        emailVerified: false,
        emails: [],
        domains: ['acme.com'],
      }),
      false,
    );
  });

  it('allows when emailVerified is true and the email matches', () => {
    assert.equal(
      shouldAllowSignIn({
        email: 'alice@acme.com',
        emailVerified: true,
        emails: [],
        domains: ['acme.com'],
      }),
      true,
    );
  });

  it('allows when emailVerified is undefined (non-OIDC providers omit the claim)', () => {
    assert.equal(
      shouldAllowSignIn({
        email: 'alice@acme.com',
        emailVerified: undefined,
        emails: [],
        domains: ['acme.com'],
      }),
      true,
    );
  });

  it('still applies the allowlist when emailVerified is true', () => {
    assert.equal(
      shouldAllowSignIn({
        email: 'mallory@evil.com',
        emailVerified: true,
        emails: [],
        domains: ['acme.com'],
      }),
      false,
    );
  });
});

describe('readAllowlistFromEnv', () => {
  const originalEmails = process.env.AUTH_ALLOWED_EMAILS;
  const originalDomains = process.env.AUTH_ALLOWED_DOMAINS;

  beforeEach(() => {
    delete process.env.AUTH_ALLOWED_EMAILS;
    delete process.env.AUTH_ALLOWED_DOMAINS;
  });

  afterEach(() => {
    if (originalEmails === undefined) delete process.env.AUTH_ALLOWED_EMAILS;
    else process.env.AUTH_ALLOWED_EMAILS = originalEmails;
    if (originalDomains === undefined) delete process.env.AUTH_ALLOWED_DOMAINS;
    else process.env.AUTH_ALLOWED_DOMAINS = originalDomains;
  });

  it('reads both env vars and normalizes them through parseAllowlist', () => {
    process.env.AUTH_ALLOWED_EMAILS = ' Foo@Bar.com , baz@qux.com ';
    process.env.AUTH_ALLOWED_DOMAINS = 'ACME.com';
    assert.deepEqual(readAllowlistFromEnv(), {
      emails: ['foo@bar.com', 'baz@qux.com'],
      domains: ['acme.com'],
    });
  });

  it('returns empty lists when neither env var is set (open-mode)', () => {
    assert.deepEqual(readAllowlistFromEnv(), { emails: [], domains: [] });
  });

  it('reflects mutations on the next call (no in-process cache)', () => {
    // The jwt callback re-checks the allowlist on every request to revoke
    // sessions when an email is removed. That contract requires the read
    // helper to be uncached.
    process.env.AUTH_ALLOWED_EMAILS = 'alice@acme.com';
    assert.deepEqual(readAllowlistFromEnv().emails, ['alice@acme.com']);
    process.env.AUTH_ALLOWED_EMAILS = '';
    assert.deepEqual(readAllowlistFromEnv().emails, []);
  });
});
