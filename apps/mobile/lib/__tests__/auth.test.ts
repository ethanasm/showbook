/**
 * Unit tests for pure auth helpers.
 *
 * Imports from auth-helpers.ts (no RN/Expo deps) — runs clean in Node.js.
 * Provider/hook tests are out of scope for M1 (we don't introduce a React
 * Native test renderer here; e2e on a real device covers it).
 *
 * Each test injects a custom fetchImpl rather than mocking the global fetch
 * to keep parallel test runs hermetic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  exchangeGoogleIdTokenForSession,
  describeSignInError,
  isExpoGoAuthUnsupported,
  isE2EMode,
  mobileTokenEndpointCandidates,
  mobileTokenEndpoint,
  loadE2ETestSession,
  E2E_TOKEN_KEY,
  E2E_USER_KEY,
} from '../auth-helpers.js';

const VALID_BODY = {
  token: 'jwt-token-string',
  user: {
    id: 'user_123',
    email: 'ethan@example.com',
    name: 'Ethan Smith',
    image: 'https://example.com/avatar.jpg',
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return impl as unknown as typeof fetch;
}

describe('exchangeGoogleIdTokenForSession', () => {
  it('happy path: 200 + valid body returns the session', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = makeFetch(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(VALID_BODY, 200);
    });

    const result = await exchangeGoogleIdTokenForSession({
      idToken: 'google-id-token',
      apiUrl: 'https://showbook.example.com',
      fetchImpl,
    });

    assert.equal(capturedUrl, 'https://showbook.example.com/api/auth/mobile-token');
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(
      (capturedInit?.headers as Record<string, string>)['content-type'],
      'application/json',
    );
    assert.equal(capturedInit?.body, JSON.stringify({ idToken: 'google-id-token' }));
    assert.deepEqual(result, VALID_BODY);
  });

  it('normalizes trailing slashes in the API URL', async () => {
    let capturedUrl = '';
    const fetchImpl = makeFetch(async (url) => {
      capturedUrl = url;
      return jsonResponse(VALID_BODY, 200);
    });

    await exchangeGoogleIdTokenForSession({
      idToken: 'google-id-token',
      apiUrl: 'https://showbook.example.com/',
      fetchImpl,
    });

    assert.equal(capturedUrl, 'https://showbook.example.com/api/auth/mobile-token');
  });

  it('falls back across localhost endpoints after network errors', async () => {
    const attempted: string[] = [];
    const fetchImpl = makeFetch(async (url) => {
      attempted.push(url);
      if (url !== 'http://127.0.0.1:3001/api/auth/mobile-token') {
        throw new Error('Network request failed');
      }
      return jsonResponse(VALID_BODY, 200);
    });

    const result = await exchangeGoogleIdTokenForSession({
      idToken: 'google-id-token',
      apiUrl: 'https://localhost:3001',
      fetchImpl,
    });

    assert.deepEqual(result, VALID_BODY);
    assert.deepEqual(attempted, [
      'https://localhost:3001/api/auth/mobile-token',
      'https://127.0.0.1:3001/api/auth/mobile-token',
      'http://localhost:3001/api/auth/mobile-token',
      'http://127.0.0.1:3001/api/auth/mobile-token',
    ]);
  });

  it('does not fallback after an HTTP response from the server', async () => {
    const attempted: string[] = [];
    const fetchImpl = makeFetch(async (url) => {
      attempted.push(url);
      return jsonResponse({ error: 'invalid_token' }, 401);
    });

    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://localhost:3001',
        fetchImpl,
      }),
      /invalid_google_token/,
    );
    assert.deepEqual(attempted, ['https://localhost:3001/api/auth/mobile-token']);
  });

  it('rejects an invalid API URL before fetch', async () => {
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'localhost:3001',
        fetchImpl: makeFetch(async () => jsonResponse(VALID_BODY, 200)),
      }),
      /api_url_invalid/,
    );
  });

  it('happy path with null name and image (acceptable shape)', async () => {
    const body = {
      token: 'jwt',
      user: { id: 'u_1', email: 'a@b.co', name: null, image: null },
    };
    const fetchImpl = makeFetch(async () => jsonResponse(body, 200));
    const result = await exchangeGoogleIdTokenForSession({
      idToken: 'x',
      apiUrl: 'https://example.com',
      fetchImpl,
    });
    assert.deepEqual(result, body);
  });

  it('401 → throws invalid_google_token', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse({ error: 'invalid_token' }, 401),
    );
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://e.co',
        fetchImpl,
      }),
      /invalid_google_token/,
    );
  });

  it('403 → throws access_denied', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse({ error: 'access_denied' }, 403),
    );
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://e.co',
        fetchImpl,
      }),
      /access_denied/,
    );
  });

  it('500 → throws server_error_500', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse({ error: 'server_error' }, 500),
    );
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://e.co',
        fetchImpl,
      }),
      /server_error_500/,
    );
  });

  it('429 → throws rate_limited', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse({ error: 'rate_limited' }, 429),
    );
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://e.co',
        fetchImpl,
      }),
      /rate_limited/,
    );
  });

  it('400 → throws server_error_400', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse({ error: 'bad_request' }, 400),
    );
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://e.co',
        fetchImpl,
      }),
      /server_error_400/,
    );
  });

  it('200 + body missing token → throws invalid_response', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse({ user: VALID_BODY.user }, 200),
    );
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://e.co',
        fetchImpl,
      }),
      /invalid_response/,
    );
  });

  it('200 + body missing user.id → throws invalid_response', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse(
        { token: 'jwt', user: { email: 'e@e.co', name: null, image: null } },
        200,
      ),
    );
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://e.co',
        fetchImpl,
      }),
      /invalid_response/,
    );
  });

  it('200 + body with empty token → throws invalid_response', async () => {
    const fetchImpl = makeFetch(async () =>
      jsonResponse({ ...VALID_BODY, token: '' }, 200),
    );
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://e.co',
        fetchImpl,
      }),
      /invalid_response/,
    );
  });

  it('200 + non-JSON body → throws invalid_response', async () => {
    const fetchImpl = makeFetch(
      async () =>
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://e.co',
        fetchImpl,
      }),
      /invalid_response/,
    );
  });

  it('network error becomes api_unreachable', async () => {
    const fetchImpl = makeFetch(async () => {
      throw new Error('network down');
    });
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://e.co',
        fetchImpl,
      }),
      /api_unreachable:network down/,
    );
  });
});

describe('mobileTokenEndpoint', () => {
  it('appends the mobile-token path', () => {
    assert.equal(
      mobileTokenEndpoint('http://localhost:3001'),
      'http://localhost:3001/api/auth/mobile-token',
    );
  });

  it('preserves a base path and removes query/hash', () => {
    assert.equal(
      mobileTokenEndpoint('https://example.com/base/?x=1#top'),
      'https://example.com/base/api/auth/mobile-token',
    );
  });
});

describe('mobileTokenEndpointCandidates', () => {
  it('returns localhost fallback candidates', () => {
    assert.deepEqual(mobileTokenEndpointCandidates('https://localhost:3001'), [
      'https://localhost:3001/api/auth/mobile-token',
      'https://127.0.0.1:3001/api/auth/mobile-token',
      'http://localhost:3001/api/auth/mobile-token',
      'http://127.0.0.1:3001/api/auth/mobile-token',
    ]);
  });

  it('does not fallback for non-localhost URLs', () => {
    assert.deepEqual(mobileTokenEndpointCandidates('https://showbook.example.com'), [
      'https://showbook.example.com/api/auth/mobile-token',
    ]);
  });
});

describe('describeSignInError', () => {
  it('maps invalid API URLs to a configuration message', () => {
    const msg = describeSignInError(new Error('api_url_invalid'));
    assert.match(msg, /EXPO_PUBLIC_API_URL|http/i);
  });

  it('maps unreachable API URLs to a backend reachability message', () => {
    const msg = describeSignInError(new Error('api_unreachable'));
    assert.match(msg, /Showbook is not reachable|web app/i);
  });

  it('preserves native fetch details for unreachable API URLs', () => {
    const msg = describeSignInError(new Error('api_unreachable:certificate rejected'));
    assert.match(msg, /certificate rejected/i);
  });

  it('maps generic React Native network failures to a localhost cert hint', () => {
    const msg = describeSignInError(new Error('api_unreachable:Network request failed'));
    assert.match(msg, /mkcert root CA|iOS simulator/i);
  });

  it('maps invalid_google_token to a retry message', () => {
    const msg = describeSignInError(new Error('invalid_google_token'));
    assert.match(msg, /GOOGLE_OAUTH_MOBILE_AUDIENCES|token/i);
  });

  it('maps access_denied to an allowlist message', () => {
    const msg = describeSignInError(new Error('access_denied'));
    assert.match(msg, /allowlist|admin|denied/i);
  });

  it('maps server_error_500 to a connectivity message', () => {
    const msg = describeSignInError(new Error('server_error_500'));
    assert.match(msg, /AUTH_SECRET|GOOGLE_OAUTH_MOBILE_AUDIENCES/i);
  });

  it('maps rate_limited to a retry-later message', () => {
    const msg = describeSignInError(new Error('rate_limited'));
    assert.match(msg, /wait|try again/i);
  });

  it('maps oauth_dismissed to a cancellation message', () => {
    const msg = describeSignInError(new Error('oauth_dismissed'));
    assert.match(msg, /cancel/i);
  });

  it('maps Expo Go OAuth attempts to a development build message', () => {
    const msg = describeSignInError(new Error('expo_go_oauth_unsupported'));
    assert.match(msg, /Expo Go|development build|redirect URI/i);
  });

  it('falls back to a generic message for unknown errors', () => {
    const msg = describeSignInError(new Error('something_random'));
    assert.match(msg, /couldn'?t sign you in/i);
  });

  it('handles non-Error throwables', () => {
    const msg = describeSignInError('string thrown');
    assert.match(msg, /couldn'?t sign you in/i);
  });
});

describe('isExpoGoAuthUnsupported', () => {
  it('returns true only for Expo Go ownership', () => {
    assert.equal(isExpoGoAuthUnsupported('expo'), true);
    assert.equal(isExpoGoAuthUnsupported('standalone'), false);
    assert.equal(isExpoGoAuthUnsupported('guest'), false);
    assert.equal(isExpoGoAuthUnsupported(null), false);
    assert.equal(isExpoGoAuthUnsupported(undefined), false);
  });
});

describe('isE2EMode', () => {
  it("returns true when EXPO_PUBLIC_E2E_MODE === '1'", () => {
    assert.equal(isE2EMode('1'), true);
  });

  it('returns false for any other truthy string', () => {
    assert.equal(isE2EMode('true'), false);
    assert.equal(isE2EMode('yes'), false);
    assert.equal(isE2EMode('0'), false);
    assert.equal(isE2EMode(''), false);
  });

  // Production-build safety: an unset env var must NEVER be interpreted
  // as E2E mode. If this assertion ever flips, every signed release would
  // bypass Google OAuth — guard it explicitly.
  it('returns false when env var is undefined (production-build safety)', () => {
    assert.equal(isE2EMode(undefined), false);
  });

  it('reads from process.env by default', () => {
    const original = process.env.EXPO_PUBLIC_E2E_MODE;
    try {
      delete process.env.EXPO_PUBLIC_E2E_MODE;
      assert.equal(isE2EMode(), false);
      process.env.EXPO_PUBLIC_E2E_MODE = '1';
      assert.equal(isE2EMode(), true);
    } finally {
      if (original === undefined) {
        delete process.env.EXPO_PUBLIC_E2E_MODE;
      } else {
        process.env.EXPO_PUBLIC_E2E_MODE = original;
      }
    }
  });
});

describe('loadE2ETestSession', () => {
  function makeStore(map: Record<string, string | null>) {
    const calls: string[] = [];
    return {
      calls,
      getItemAsync: async (key: string) => {
        calls.push(key);
        return map[key] ?? null;
      },
    };
  }

  const VALID_USER = {
    id: 'u_e2e',
    email: 'e2e@showbook.test',
    name: 'E2E User',
    image: null,
  };

  it('returns the bundled session when EXPO_PUBLIC_E2E_TEST_* are set', async () => {
    // Empty SecureStore — bundled env vars should win and SecureStore
    // shouldn't even be touched.
    const store = makeStore({});
    const session = await loadE2ETestSession(store, {
      bundledToken: 'jwt-from-build-env',
      bundledUserJson: JSON.stringify(VALID_USER),
    });
    assert.deepEqual(session, { token: 'jwt-from-build-env', user: VALID_USER });
    assert.deepEqual(store.calls, []);
  });

  it('prefers bundled env over SecureStore when both are present', async () => {
    const store = makeStore({
      [E2E_TOKEN_KEY]: 'jwt-from-securestore',
      [E2E_USER_KEY]: JSON.stringify({ ...VALID_USER, id: 'securestore-user' }),
    });
    const session = await loadE2ETestSession(store, {
      bundledToken: 'jwt-from-build-env',
      bundledUserJson: JSON.stringify(VALID_USER),
    });
    assert.equal(session?.token, 'jwt-from-build-env');
    assert.equal(session?.user.id, VALID_USER.id);
    assert.deepEqual(store.calls, []);
  });

  it('falls back to SecureStore when bundled env vars are empty', async () => {
    const store = makeStore({
      [E2E_TOKEN_KEY]: 'jwt-from-securestore',
      [E2E_USER_KEY]: JSON.stringify(VALID_USER),
    });
    const session = await loadE2ETestSession(store, {
      bundledToken: '',
      bundledUserJson: '',
    });
    assert.deepEqual(session, { token: 'jwt-from-securestore', user: VALID_USER });
    assert.deepEqual(store.calls.sort(), [E2E_TOKEN_KEY, E2E_USER_KEY].sort());
  });

  it('returns the session when both SecureStore keys are present and valid', async () => {
    const store = makeStore({
      [E2E_TOKEN_KEY]: 'jwt-from-maestro',
      [E2E_USER_KEY]: JSON.stringify(VALID_USER),
    });
    const session = await loadE2ETestSession(store, {
      bundledToken: undefined,
      bundledUserJson: undefined,
    });
    assert.deepEqual(session, { token: 'jwt-from-maestro', user: VALID_USER });
    assert.deepEqual(store.calls.sort(), [E2E_TOKEN_KEY, E2E_USER_KEY].sort());
  });

  it('returns null when SecureStore token is missing and no bundled env', async () => {
    const store = makeStore({
      [E2E_USER_KEY]: JSON.stringify({
        id: 'u',
        email: 'a@b.co',
        name: null,
        image: null,
      }),
    });
    assert.equal(
      await loadE2ETestSession(store, { bundledToken: '', bundledUserJson: '' }),
      null,
    );
  });

  it('returns null when SecureStore user blob is missing and no bundled env', async () => {
    const store = makeStore({ [E2E_TOKEN_KEY]: 'jwt' });
    assert.equal(
      await loadE2ETestSession(store, { bundledToken: '', bundledUserJson: '' }),
      null,
    );
  });

  it('returns null when bundled user JSON is malformed', async () => {
    const store = makeStore({});
    const session = await loadE2ETestSession(store, {
      bundledToken: 'jwt',
      bundledUserJson: '{not json',
    });
    // Bundled-env was tried but failed to parse; SecureStore is empty,
    // so the overall result is null. The fact that bundled took priority
    // means we did NOT silently fall through to a stale SecureStore copy.
    assert.equal(session, null);
  });

  it('returns null when SecureStore user blob is not valid JSON', async () => {
    const store = makeStore({
      [E2E_TOKEN_KEY]: 'jwt',
      [E2E_USER_KEY]: '{not json',
    });
    assert.equal(
      await loadE2ETestSession(store, { bundledToken: '', bundledUserJson: '' }),
      null,
    );
  });

  it('returns null when user blob is missing required fields', async () => {
    const store = makeStore({
      [E2E_TOKEN_KEY]: 'jwt',
      [E2E_USER_KEY]: JSON.stringify({ email: 'a@b.co' }),
    });
    assert.equal(
      await loadE2ETestSession(store, { bundledToken: '', bundledUserJson: '' }),
      null,
    );
  });

  it('uses the documented SecureStore keys', () => {
    // Maestro flows reference these literal strings; if they ever change
    // the e2e flow YAML must change too. Pin them here as a safety net.
    assert.equal(E2E_TOKEN_KEY, 'e2e.test-token');
    assert.equal(E2E_USER_KEY, 'e2e.test-user');
  });
});
