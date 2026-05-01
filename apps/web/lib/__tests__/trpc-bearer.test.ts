/**
 * Unit tests for the tRPC route's session-resolution helper.
 *
 * The route extracts the precedence rules into the pure helper
 * `resolveTrpcSession` (apps/web/app/api/trpc/[trpc]/resolve-session.ts);
 * see that file's header comment for the rule list. These tests pin the
 * rules in place so they can't regress without a failing test.
 *
 * The helper takes a decoder, an allowlist checker, and a cookie-session
 * getter — the tests inject fakes rather than the real
 * `decodeMobileToken`/`auth()` IO so the suite stays fast and hermetic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveTrpcSession,
  type DecodedMobileToken,
  type ResolvedSession,
  type MinimalLogger,
} from '../../app/api/trpc/[trpc]/resolve-session';
import { isEmailAllowed } from '../auth-allowlist';

const SECRET = 'super-secret-for-tests-at-least-32-chars!!';

interface CallTracker {
  decodeCalls: Array<{ token: string; secret: string }>;
  cookieSessionCalls: number;
  allowlistDeniedCalls: number;
}

function makeTracker(): CallTracker {
  return { decodeCalls: [], cookieSessionCalls: 0, allowlistDeniedCalls: 0 };
}

function makeLog(tracker: CallTracker): MinimalLogger {
  return {
    info(obj) {
      if (obj.event === 'auth.mobile_session_denied') {
        tracker.allowlistDeniedCalls++;
      }
    },
  };
}

function makeDecoder(
  tracker: CallTracker,
  result: DecodedMobileToken | null,
): (args: { token: string; secret: string }) => Promise<DecodedMobileToken | null> {
  return async (args) => {
    tracker.decodeCalls.push({ token: args.token, secret: args.secret });
    return result;
  };
}

function makeCookieGetter(
  tracker: CallTracker,
  session: ResolvedSession | null,
): () => Promise<ResolvedSession | null> {
  return async () => {
    tracker.cookieSessionCalls++;
    return session;
  };
}

// ---------------------------------------------------------------------------
// 1. valid Bearer JWT → tRPC sees user.id from the JWT (cookie not consulted)
// ---------------------------------------------------------------------------

describe('resolveTrpcSession — valid Bearer', () => {
  it('returns the bearer-derived session and never calls the cookie getter', async () => {
    const tracker = makeTracker();
    const session = await resolveTrpcSession({
      authHeader: 'Bearer valid.jwt.here',
      secret: SECRET,
      decode: makeDecoder(tracker, { id: 'user-bearer-123', email: 'alice@example.com' }),
      allowlist: { emails: [], domains: [] }, // open mode — any email allowed
      isEmailAllowed,
      // If this were called, the test would surface it via cookieSessionCalls.
      getCookieSession: makeCookieGetter(tracker, { user: { id: 'cookie-user' } }),
      log: makeLog(tracker),
    });

    assert.deepEqual(session, { user: { id: 'user-bearer-123' } });
    assert.equal(tracker.decodeCalls.length, 1, 'decoder should be called once');
    assert.equal(tracker.decodeCalls[0]?.token, 'valid.jwt.here', 'raw token without "Bearer " prefix');
    assert.equal(tracker.decodeCalls[0]?.secret, SECRET);
    assert.equal(
      tracker.cookieSessionCalls,
      0,
      'cookie session must NOT be consulted when bearer succeeds',
    );
  });

  it('strips the "Bearer " prefix even with extra whitespace in the token body', async () => {
    const tracker = makeTracker();
    await resolveTrpcSession({
      authHeader: 'Bearer abc.def.ghi',
      secret: SECRET,
      decode: makeDecoder(tracker, { id: 'u1', email: 'a@b.com' }),
      allowlist: { emails: [], domains: [] },
      isEmailAllowed,
      getCookieSession: makeCookieGetter(tracker, null),
      log: makeLog(tracker),
    });
    assert.equal(tracker.decodeCalls[0]?.token, 'abc.def.ghi');
  });
});

// ---------------------------------------------------------------------------
// 2. invalid Bearer JWT → unauthenticated, no fallback to cookies
// ---------------------------------------------------------------------------

describe('resolveTrpcSession — invalid Bearer', () => {
  it('returns null and does NOT fall back to cookie auth', async () => {
    const tracker = makeTracker();
    const session = await resolveTrpcSession({
      authHeader: 'Bearer not.a.real.jwt',
      secret: SECRET,
      // decoder returns null — token couldn't be verified
      decode: makeDecoder(tracker, null),
      allowlist: { emails: [], domains: [] },
      isEmailAllowed,
      getCookieSession: makeCookieGetter(tracker, { user: { id: 'cookie-user' } }),
      log: makeLog(tracker),
    });

    assert.equal(session, null, 'invalid bearer => null session');
    assert.equal(
      tracker.cookieSessionCalls,
      0,
      'cookie path must NOT run when a bearer is presented (even an invalid one)',
    );
  });

  it('returns null when AUTH_SECRET is missing (cannot decode a bearer at all)', async () => {
    const tracker = makeTracker();
    const session = await resolveTrpcSession({
      authHeader: 'Bearer some.token',
      secret: undefined, // simulates a misconfigured server
      decode: makeDecoder(tracker, { id: 'u1', email: 'a@b.com' }), // never called
      allowlist: { emails: [], domains: [] },
      isEmailAllowed,
      getCookieSession: makeCookieGetter(tracker, { user: { id: 'cookie-user' } }),
      log: makeLog(tracker),
    });

    assert.equal(session, null);
    assert.equal(tracker.decodeCalls.length, 0, 'decoder is unreachable without a secret');
    assert.equal(tracker.cookieSessionCalls, 0, 'still no cookie fallback');
  });
});

// ---------------------------------------------------------------------------
// 3. valid Bearer but disallowed email → unauthenticated even if cookie would
//    have allowed
// ---------------------------------------------------------------------------

describe('resolveTrpcSession — bearer with email no longer on allowlist', () => {
  it('returns null and logs auth.mobile_session_denied without falling back to cookies', async () => {
    const tracker = makeTracker();
    const session = await resolveTrpcSession({
      authHeader: 'Bearer good.signed.jwt',
      secret: SECRET,
      // decoder succeeds — token is cryptographically valid
      decode: makeDecoder(tracker, { id: 'user-removed', email: 'removed@evil.com' }),
      // ...but the email is not on the allowlist (operator removed them today)
      allowlist: { emails: ['kept@acme.com'], domains: [] },
      isEmailAllowed,
      // Cookie getter would return a session for a different user — must not be reached
      getCookieSession: makeCookieGetter(tracker, { user: { id: 'cookie-different-user' } }),
      log: makeLog(tracker),
    });

    assert.equal(session, null);
    assert.equal(tracker.allowlistDeniedCalls, 1, 'should log denial event');
    assert.equal(tracker.cookieSessionCalls, 0, 'must not fall through to cookies');
  });
});

// ---------------------------------------------------------------------------
// 4. no Bearer → falls back to cookie auth
// ---------------------------------------------------------------------------

describe('resolveTrpcSession — no Bearer header', () => {
  it('falls through to cookie auth when authHeader is null', async () => {
    const tracker = makeTracker();
    const session = await resolveTrpcSession({
      authHeader: null,
      secret: SECRET,
      decode: makeDecoder(tracker, null), // never called
      allowlist: { emails: [], domains: [] },
      isEmailAllowed,
      getCookieSession: makeCookieGetter(tracker, { user: { id: 'cookie-user-7' } }),
      log: makeLog(tracker),
    });

    assert.deepEqual(session, { user: { id: 'cookie-user-7' } });
    assert.equal(tracker.decodeCalls.length, 0, 'no bearer => decoder not called');
    assert.equal(tracker.cookieSessionCalls, 1);
  });

  it('falls through to cookie auth for non-Bearer Authorization schemes', async () => {
    // e.g. a stray "Basic" header from some browser extension shouldn't
    // hijack the request away from cookie auth.
    const tracker = makeTracker();
    const session = await resolveTrpcSession({
      authHeader: 'Basic dXNlcjpwYXNz',
      secret: SECRET,
      decode: makeDecoder(tracker, null),
      allowlist: { emails: [], domains: [] },
      isEmailAllowed,
      getCookieSession: makeCookieGetter(tracker, { user: { id: 'cookie-user-8' } }),
      log: makeLog(tracker),
    });

    assert.deepEqual(session, { user: { id: 'cookie-user-8' } });
    assert.equal(tracker.decodeCalls.length, 0);
    assert.equal(tracker.cookieSessionCalls, 1);
  });

  it('returns null when no bearer is presented and the cookie session is also empty', async () => {
    const tracker = makeTracker();
    const session = await resolveTrpcSession({
      authHeader: null,
      secret: SECRET,
      decode: makeDecoder(tracker, null),
      allowlist: { emails: [], domains: [] },
      isEmailAllowed,
      getCookieSession: makeCookieGetter(tracker, null),
      log: makeLog(tracker),
    });

    assert.equal(session, null);
    assert.equal(tracker.cookieSessionCalls, 1);
  });
});
