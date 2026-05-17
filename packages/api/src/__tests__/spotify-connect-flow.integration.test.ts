/**
 * Integration test: connect → persist → fetch with `ensureFreshUserToken`
 * → refresh round-trip against the real Postgres `showbook_e2e` DB.
 *
 * No real Spotify HTTP — `globalThis.fetch` is stubbed to mimic the
 * three Spotify endpoints our flow touches:
 *   - `accounts.spotify.com/api/token` (auth-code exchange + refresh)
 *   - `api.spotify.com/v1/me` (profile lookup)
 *
 * The point is the *DB hops*: the encrypted-at-rest row, the read +
 * decrypt cycle, the refresh-and-rewrite path, and the revoked-soft-
 * delete on disconnect.
 */

import { describe, it, before, beforeEach, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db, userSpotifyTokens } from '@showbook/db';
import {
  exchangeAuthorizationCode,
  getCurrentUser,
} from '../spotify';
import {
  disconnectSpotify,
  ensureFreshUserToken,
  getConnectionStatus,
  isSpotifyConnected,
  persistInitialToken,
} from '../spotify-tokens';
import { __resetKeyCacheForTests } from '../crypto';
import {
  cleanupByPrefix,
  createTestUser,
  withTimeout,
} from './_test-helpers';

const PREFIX = 'spotcon-';
const USER_ID = `${PREFIX}user-1`;

let origFetch: typeof globalThis.fetch;
let origKey: string | undefined;
let origClientId: string | undefined;
let origClientSecret: string | undefined;

before(async () => {
  await withTimeout(45_000, async () => {
    await createTestUser(USER_ID);
  });
});

beforeEach(() => {
  origFetch = globalThis.fetch;
  origKey = process.env.TOKEN_KEY;
  origClientId = process.env.SPOTIFY_CLIENT_ID;
  origClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  process.env.TOKEN_KEY = 'a'.repeat(64);
  process.env.SPOTIFY_CLIENT_ID = 'test-client';
  process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
  __resetKeyCacheForTests();
});

afterEach(async () => {
  globalThis.fetch = origFetch;
  if (origKey === undefined) delete process.env.TOKEN_KEY;
  else process.env.TOKEN_KEY = origKey;
  if (origClientId === undefined) delete process.env.SPOTIFY_CLIENT_ID;
  else process.env.SPOTIFY_CLIENT_ID = origClientId;
  if (origClientSecret === undefined) delete process.env.SPOTIFY_CLIENT_SECRET;
  else process.env.SPOTIFY_CLIENT_SECRET = origClientSecret;
  // Reset any tokens written during the test so each scenario starts
  // from a clean slate.
  await db.delete(userSpotifyTokens).where(eq(userSpotifyTokens.userId, USER_ID));
});

after(async () => {
  await withTimeout(45_000, async () => {
    await cleanupByPrefix(PREFIX);
  });
});

function mockSpotifyHosts(opts: {
  exchangeResponse?: { status: number; body: unknown };
  refreshResponse?: { status: number; body: unknown };
  meResponse?: { status: number; body: unknown };
}) {
  const exchange = opts.exchangeResponse ?? {
    status: 200,
    body: {
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      scope: 'user-follow-read',
      token_type: 'Bearer',
    },
  };
  const refresh = opts.refreshResponse ?? {
    status: 200,
    body: {
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      expires_in: 3600,
      scope: 'user-follow-read playlist-modify-private',
      token_type: 'Bearer',
    },
  };
  const me = opts.meResponse ?? {
    status: 200,
    body: { id: 'sp-user-xyz', display_name: 'Phoebe', product: 'premium' },
  };

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const u = new URL(url);
    if (u.host === 'accounts.spotify.com' && u.pathname === '/api/token') {
      const body = new URLSearchParams(init?.body as string);
      const grant = body.get('grant_type');
      const target = grant === 'refresh_token' ? refresh : exchange;
      return new Response(JSON.stringify(target.body), {
        status: target.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.host === 'api.spotify.com' && u.pathname === '/v1/me') {
      return new Response(JSON.stringify(me.body), {
        status: me.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof globalThis.fetch;
}

describe('spotify connect → persist → ensureFreshUserToken', () => {
  it('exchange + persist writes an encrypted row that ensureFreshUserToken can read', async () => {
    mockSpotifyHosts({});
    const tokens = await exchangeAuthorizationCode({
      code: 'fake-auth-code',
      redirectUri: 'https://example.test/api/spotify/callback',
    });
    const profile = await getCurrentUser(tokens.accessToken);
    await persistInitialToken({ userId: USER_ID, tokens, profile });

    // The row exists, ciphertext is *not* the plaintext token.
    const [row] = await db
      .select()
      .from(userSpotifyTokens)
      .where(eq(userSpotifyTokens.userId, USER_ID));
    assert.ok(row, 'token row should exist');
    assert.notEqual(row!.accessTokenEnc, 'access-1');
    assert.notEqual(row!.refreshTokenEnc, 'refresh-1');
    assert.equal(row!.spotifyUserId, 'sp-user-xyz');
    assert.equal(row!.displayName, 'Phoebe');
    assert.equal(row!.product, 'premium');

    // Status is connected.
    assert.equal(await isSpotifyConnected(USER_ID), true);
    const status = await getConnectionStatus(USER_ID);
    assert.equal(status.connected, true);
    assert.equal(status.displayName, 'Phoebe');

    // ensureFreshUserToken returns the plaintext access token (fast path —
    // expiry is 1h out).
    const fresh = await ensureFreshUserToken(USER_ID);
    assert.equal(fresh, 'access-1');
  });

  it('refreshes when the persisted token is near expiry', async () => {
    mockSpotifyHosts({});
    const tokens = await exchangeAuthorizationCode({
      code: 'fake-auth-code',
      redirectUri: 'https://example.test/api/spotify/callback',
    });
    const profile = await getCurrentUser(tokens.accessToken);
    await persistInitialToken({ userId: USER_ID, tokens, profile });

    // Force the row near expiry so ensureFreshUserToken triggers a refresh.
    await db
      .update(userSpotifyTokens)
      .set({ expiresAt: new Date(Date.now() + 30 * 1000) })
      .where(eq(userSpotifyTokens.userId, USER_ID));

    const refreshed = await ensureFreshUserToken(USER_ID);
    assert.equal(refreshed, 'access-2', 'refresh response wins');

    // The refresh updated the row's scope + extended expiry.
    const [row] = await db
      .select()
      .from(userSpotifyTokens)
      .where(eq(userSpotifyTokens.userId, USER_ID));
    assert.ok(row);
    assert.equal(row!.scope, 'user-follow-read playlist-modify-private');
    assert.ok(row!.expiresAt.getTime() > Date.now() + 30 * 60 * 1000);
    assert.ok(row!.lastRefreshedAt);
  });

  it('marks revoked + returns null when refresh response is 401', async () => {
    mockSpotifyHosts({
      refreshResponse: {
        status: 401,
        body: { error: 'invalid_grant', error_description: 'revoked' },
      },
    });
    const tokens = await exchangeAuthorizationCode({
      code: 'fake-auth-code',
      redirectUri: 'https://example.test/api/spotify/callback',
    });
    const profile = await getCurrentUser(tokens.accessToken);
    await persistInitialToken({ userId: USER_ID, tokens, profile });
    await db
      .update(userSpotifyTokens)
      .set({ expiresAt: new Date(Date.now() + 30 * 1000) })
      .where(eq(userSpotifyTokens.userId, USER_ID));

    const result = await ensureFreshUserToken(USER_ID);
    assert.equal(result, null, '401 → null');
    const [row] = await db
      .select()
      .from(userSpotifyTokens)
      .where(eq(userSpotifyTokens.userId, USER_ID));
    assert.ok(row!.revokedAt instanceof Date);
    assert.equal(row!.revokedReason, '401_from_spotify');
    assert.equal(await isSpotifyConnected(USER_ID), false);
  });

  it('disconnect soft-deletes the row and flips the status', async () => {
    mockSpotifyHosts({});
    const tokens = await exchangeAuthorizationCode({
      code: 'fake-auth-code',
      redirectUri: 'https://example.test/api/spotify/callback',
    });
    const profile = await getCurrentUser(tokens.accessToken);
    await persistInitialToken({ userId: USER_ID, tokens, profile });

    await disconnectSpotify(USER_ID, 'user_disconnect');

    assert.equal(await isSpotifyConnected(USER_ID), false);
    const [row] = await db
      .select()
      .from(userSpotifyTokens)
      .where(eq(userSpotifyTokens.userId, USER_ID));
    assert.ok(row, 'row should still exist (audit)');
    assert.ok(row!.revokedAt instanceof Date);
    assert.equal(row!.revokedReason, 'user_disconnect');
    // Reading the token after disconnect returns null.
    assert.equal(await ensureFreshUserToken(USER_ID), null);
  });

  it('re-connect after disconnect overwrites the existing row', async () => {
    mockSpotifyHosts({});
    let tokens = await exchangeAuthorizationCode({
      code: 'fake-auth-code',
      redirectUri: 'https://example.test/api/spotify/callback',
    });
    let profile = await getCurrentUser(tokens.accessToken);
    await persistInitialToken({ userId: USER_ID, tokens, profile });
    await disconnectSpotify(USER_ID, 'user_disconnect');
    assert.equal(await isSpotifyConnected(USER_ID), false);

    // Re-connect — second persist should clear revoked_at.
    tokens = await exchangeAuthorizationCode({
      code: 'fake-auth-code-2',
      redirectUri: 'https://example.test/api/spotify/callback',
    });
    profile = await getCurrentUser(tokens.accessToken);
    await persistInitialToken({ userId: USER_ID, tokens, profile });

    assert.equal(await isSpotifyConnected(USER_ID), true);
    const [row] = await db
      .select()
      .from(userSpotifyTokens)
      .where(eq(userSpotifyTokens.userId, USER_ID));
    assert.equal(row!.revokedAt, null);
    assert.equal(row!.revokedReason, null);
  });
});
