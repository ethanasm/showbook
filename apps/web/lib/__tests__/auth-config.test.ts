import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authConfig } from '../../auth.config';

// Tests against the live signIn / jwt callbacks defined in auth.config.ts.
// They exist to lock in the security-critical wiring (env-driven allowlist
// re-check on every JWT decode, email_verified gate on sign-in) since the
// pure helpers in auth-allowlist.ts can be reused in places that aren't
// the auth callback.

const callbacks = authConfig.callbacks!;

const ORIGINAL_EMAILS = process.env.AUTH_ALLOWED_EMAILS;
const ORIGINAL_DOMAINS = process.env.AUTH_ALLOWED_DOMAINS;

function restoreEnv() {
  if (ORIGINAL_EMAILS === undefined) delete process.env.AUTH_ALLOWED_EMAILS;
  else process.env.AUTH_ALLOWED_EMAILS = ORIGINAL_EMAILS;
  if (ORIGINAL_DOMAINS === undefined) delete process.env.AUTH_ALLOWED_DOMAINS;
  else process.env.AUTH_ALLOWED_DOMAINS = ORIGINAL_DOMAINS;
}

// The NextAuth callback parameter types are large discriminated unions that
// we don't want to spell out in tests. The runtime shape we actually depend
// on is small — { user, profile } for signIn and { token, user? } for jwt.
type SignInArgs = Parameters<NonNullable<typeof callbacks.signIn>>[0];
type JwtArgs = Parameters<NonNullable<typeof callbacks.jwt>>[0];
const callSignIn = (args: {
  user: { email?: string | null };
  profile?: { email_verified?: boolean };
}) => callbacks.signIn!(args as unknown as SignInArgs);
const callJwt = (args: {
  token: { id?: string; email?: string | null };
  user?: { id: string };
}) => callbacks.jwt!(args as unknown as JwtArgs);

describe('authConfig.signIn', () => {
  beforeEach(() => {
    process.env.AUTH_ALLOWED_EMAILS = '';
    process.env.AUTH_ALLOWED_DOMAINS = 'acme.com';
  });
  afterEach(restoreEnv);

  it('rejects an unverified Google profile even when the email is on the allowlist', async () => {
    const result = await callSignIn({
      user: { email: 'alice@acme.com' },
      profile: { email_verified: false },
    });
    assert.equal(result, false);
  });

  it('allows a verified Google profile that matches the allowlist', async () => {
    const result = await callSignIn({
      user: { email: 'alice@acme.com' },
      profile: { email_verified: true },
    });
    assert.equal(result, true);
  });

  it('rejects a verified profile whose email is not on the allowlist', async () => {
    const result = await callSignIn({
      user: { email: 'mallory@evil.com' },
      profile: { email_verified: true },
    });
    assert.equal(result, false);
  });
});

describe('authConfig.jwt (allowlist re-check)', () => {
  afterEach(restoreEnv);

  it('returns null when the email is no longer on the allowlist (revokes existing JWT sessions)', async () => {
    // Scenario: user signed in yesterday when alice@acme.com was allowed.
    // Operator removed acme.com from AUTH_ALLOWED_DOMAINS today. Their
    // existing JWT must not keep working — null tells NextAuth to clear
    // the session cookie on the next request.
    process.env.AUTH_ALLOWED_EMAILS = '';
    process.env.AUTH_ALLOWED_DOMAINS = 'other.com';
    const result = await callJwt({
      token: { id: 'user-1', email: 'alice@acme.com' },
    });
    assert.equal(result, null);
  });

  it('keeps the token when the email is still on the allowlist', async () => {
    process.env.AUTH_ALLOWED_EMAILS = '';
    process.env.AUTH_ALLOWED_DOMAINS = 'acme.com';
    const result = await callJwt({
      token: { id: 'user-1', email: 'alice@acme.com' },
    });
    assert.notEqual(result, null);
    assert.equal((result as { id: string }).id, 'user-1');
  });

  it('keeps the token in open-mode (both env vars unset)', async () => {
    delete process.env.AUTH_ALLOWED_EMAILS;
    delete process.env.AUTH_ALLOWED_DOMAINS;
    const result = await callJwt({
      token: { id: 'user-1', email: 'anyone@anywhere.com' },
    });
    assert.notEqual(result, null);
  });

  it('returns null when the token has no email and the allowlist is set', async () => {
    // A bare JWT with id but no email shouldn't slip past — that would
    // be an unexpected shape, and erring on the side of revoking is
    // safer than letting it through.
    process.env.AUTH_ALLOWED_EMAILS = 'alice@acme.com';
    delete process.env.AUTH_ALLOWED_DOMAINS;
    const result = await callJwt({ token: { id: 'user-1' } });
    assert.equal(result, null);
  });

  it('writes user.id onto the token on initial sign-in', async () => {
    process.env.AUTH_ALLOWED_EMAILS = '';
    process.env.AUTH_ALLOWED_DOMAINS = 'acme.com';
    const result = await callJwt({
      token: { email: 'alice@acme.com' },
      user: { id: 'new-user-id' },
    });
    assert.equal((result as { id: string }).id, 'new-user-id');
  });
});
