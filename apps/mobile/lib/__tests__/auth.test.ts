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
  isE2EMode,
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

  it('network error propagates verbatim', async () => {
    const fetchImpl = makeFetch(async () => {
      throw new Error('network down');
    });
    await assert.rejects(
      exchangeGoogleIdTokenForSession({
        idToken: 'x',
        apiUrl: 'https://e.co',
        fetchImpl,
      }),
      /network down/,
    );
  });
});

describe('describeSignInError', () => {
  it('maps invalid_google_token to a retry message', () => {
    const msg = describeSignInError(new Error('invalid_google_token'));
    assert.match(msg, /try again/i);
  });

  it('maps access_denied to an allowlist message', () => {
    const msg = describeSignInError(new Error('access_denied'));
    assert.match(msg, /allowlist|admin|denied/i);
  });

  it('maps server_error_500 to a connectivity message', () => {
    const msg = describeSignInError(new Error('server_error_500'));
    assert.match(msg, /reach showbook|moment/i);
  });

  it('maps oauth_dismissed to a cancellation message', () => {
    const msg = describeSignInError(new Error('oauth_dismissed'));
    assert.match(msg, /cancel/i);
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

  it('returns the session when both keys are present and valid', async () => {
    const user = {
      id: 'u_e2e',
      email: 'e2e@showbook.test',
      name: 'E2E User',
      image: null,
    };
    const store = makeStore({
      [E2E_TOKEN_KEY]: 'jwt-from-maestro',
      [E2E_USER_KEY]: JSON.stringify(user),
    });
    const session = await loadE2ETestSession(store);
    assert.deepEqual(session, { token: 'jwt-from-maestro', user });
    assert.deepEqual(store.calls.sort(), [E2E_TOKEN_KEY, E2E_USER_KEY].sort());
  });

  it('returns null when token is missing', async () => {
    const store = makeStore({
      [E2E_USER_KEY]: JSON.stringify({
        id: 'u',
        email: 'a@b.co',
        name: null,
        image: null,
      }),
    });
    assert.equal(await loadE2ETestSession(store), null);
  });

  it('returns null when user blob is missing', async () => {
    const store = makeStore({ [E2E_TOKEN_KEY]: 'jwt' });
    assert.equal(await loadE2ETestSession(store), null);
  });

  it('returns null when user blob is not valid JSON', async () => {
    const store = makeStore({
      [E2E_TOKEN_KEY]: 'jwt',
      [E2E_USER_KEY]: '{not json',
    });
    assert.equal(await loadE2ETestSession(store), null);
  });

  it('returns null when user blob is missing required fields', async () => {
    const store = makeStore({
      [E2E_TOKEN_KEY]: 'jwt',
      [E2E_USER_KEY]: JSON.stringify({ email: 'a@b.co' }),
    });
    assert.equal(await loadE2ETestSession(store), null);
  });

  it('uses the documented SecureStore keys', () => {
    // Maestro flows reference these literal strings; if they ever change
    // the e2e flow YAML must change too. Pin them here as a safety net.
    assert.equal(E2E_TOKEN_KEY, 'e2e.test-token');
    assert.equal(E2E_USER_KEY, 'e2e.test-user');
  });
});
