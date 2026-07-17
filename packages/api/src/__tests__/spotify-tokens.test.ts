/**
 * Unit tests for `spotify-tokens.ts`. Mocks `@showbook/db` so each test
 * scripts the chain of select / update calls that `ensureFreshUserToken`
 * makes, and stubs `refreshSpotifyToken` so the refresh path doesn't
 * touch real network.
 *
 * Coverage focus: the four user-visible states the helper has to
 * navigate — fresh token, near-expiry refresh, Spotify 401 → mark
 * revoked, missing row.
 */

import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as realDb from '@showbook/db';

interface Script {
  selectResults: unknown[][];
  updateCalls: { set: Record<string, unknown> }[];
  refreshHandler: ((refreshToken: string) => Promise<unknown>) | null;
}

const SCRIPT: Script = {
  selectResults: [],
  updateCalls: [],
  refreshHandler: null,
};

function reset() {
  SCRIPT.selectResults = [];
  SCRIPT.updateCalls = [];
  SCRIPT.refreshHandler = null;
}

function mkChain(getResult: () => unknown) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') {
        try {
          const value = getResult();
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve(value).then(resolve);
        } catch (err) {
          return (
            _resolve: (v: unknown) => unknown,
            reject?: (e: unknown) => unknown,
          ) =>
            Promise.reject(err).catch((e) =>
              reject ? reject(e) : Promise.reject(e),
            );
        }
      }
      return () => proxy;
    },
  };
  const proxy: object = new Proxy({}, handler);
  return proxy;
}

const fakeDb = {
  select: () => mkChain(() => SCRIPT.selectResults.shift() ?? []),
  update: (_table: unknown) => {
    let captured: Record<string, unknown> = {};
    const handler: ProxyHandler<object> = {
      get(_t, prop) {
        if (prop === 'set') {
          return (values: Record<string, unknown>) => {
            captured = values;
            return proxy;
          };
        }
        if (prop === 'then') {
          SCRIPT.updateCalls.push({ set: captured });
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve([]).then(resolve);
        }
        return () => proxy;
      },
    };
    const proxy: object = new Proxy({}, handler);
    return proxy;
  },
  insert: () => {
    const handler: ProxyHandler<object> = {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve([]).then(resolve);
        }
        return () => proxy;
      },
    };
    const proxy: object = new Proxy({}, handler);
    return proxy;
  },
  transaction: async (fn: (tx: unknown) => unknown) => fn(fakeDb),
  execute: async () => undefined,
};

mock.module('@showbook/db', {
  namedExports: { ...realDb, db: fakeDb },
});

// Hoisted so tests can throw the exact class the mocked module exports.
// Never re-import the mock through a different specifier ('../spotify' vs
// '../spotify.js') to get at this class: whether those two specifiers hit
// the same mock registration depends on the loader's resolution
// normalization, and a mismatch hands the test a different SpotifyError
// identity than the module under test sees — `instanceof` then fails and
// the 401 path stops being recognized (exactly how this file broke in CI
// while passing locally).
class MockSpotifyError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
    this.name = 'SpotifyError';
  }
}

mock.module('../spotify.js', {
  namedExports: {
    refreshSpotifyToken: async (refreshToken: string) =>
      SCRIPT.refreshHandler
        ? SCRIPT.refreshHandler(refreshToken)
        : {
            accessToken: 'refreshed-access',
            refreshToken,
            expiresIn: 3600,
            scope: 'user-follow-read',
            tokenType: 'Bearer',
          },
    SpotifyError: MockSpotifyError,
  },
});

let mod: typeof import('../spotify-tokens');
let origKey: string | undefined;

before(async () => {
  mod = await import('../spotify-tokens');
});

beforeEach(() => {
  reset();
  origKey = process.env.TOKEN_KEY;
  process.env.TOKEN_KEY = 'a'.repeat(64);
  // Reset crypto module's cached key — important when previous test
  // changed it.
  const crypto = require('../crypto') as typeof import('../crypto');
  crypto.__resetKeyCacheForTests();
});

afterEach(() => {
  if (origKey === undefined) delete process.env.TOKEN_KEY;
  else process.env.TOKEN_KEY = origKey;
});

function tokenRow(opts: { expiresAt: Date; revokedAt?: Date | null }) {
  // Use the real crypto so what we put on disk is what `decrypt` will
  // accept inside the helper. Imported lazily so the test setup that
  // resets TOKEN_KEY runs first.
  const { encrypt } = require('../crypto') as typeof import('../crypto');
  return {
    userId: 'user-1',
    accessTokenEnc: encrypt('current-access-token'),
    refreshTokenEnc: encrypt('current-refresh-token'),
    scope: 'user-follow-read',
    expiresAt: opts.expiresAt,
    spotifyUserId: 'sp-user-1',
    displayName: 'Test User',
    product: 'premium',
    lastUsedAt: null,
    lastRefreshedAt: null,
    revokedAt: opts.revokedAt ?? null,
    revokedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('ensureFreshUserToken', () => {
  it('returns null when there is no row for the user', async () => {
    SCRIPT.selectResults = [[]]; // no rows
    const result = await mod.ensureFreshUserToken('user-1');
    assert.equal(result, null);
  });

  it('returns the decrypted access token on the fast path (still fresh)', async () => {
    const row = tokenRow({
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h from now
    });
    SCRIPT.selectResults = [[row]];
    const result = await mod.ensureFreshUserToken('user-1');
    assert.equal(result, 'current-access-token');
    // updates lastUsedAt
    assert.equal(SCRIPT.updateCalls.length, 1);
    assert.ok(SCRIPT.updateCalls[0]?.set.lastUsedAt instanceof Date);
  });

  it('refreshes when within the 60s window and persists the new token', async () => {
    const row = tokenRow({
      expiresAt: new Date(Date.now() + 30 * 1000), // 30s from now — under window
    });
    SCRIPT.selectResults = [[row]];
    SCRIPT.refreshHandler = async () => ({
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      expiresIn: 3600,
      scope: 'user-follow-read playlist-modify-private',
      tokenType: 'Bearer',
    });
    const result = await mod.ensureFreshUserToken('user-1');
    assert.equal(result, 'fresh-access');
    assert.equal(SCRIPT.updateCalls.length, 1);
    const set = SCRIPT.updateCalls[0]!.set;
    assert.ok(set.lastRefreshedAt instanceof Date);
    assert.ok(set.expiresAt instanceof Date);
    assert.equal(
      set.scope,
      'user-follow-read playlist-modify-private',
      'scope from refresh response is persisted',
    );
  });

  it('marks the row revoked and returns null on Spotify 401', async () => {
    const row = tokenRow({
      expiresAt: new Date(Date.now() + 30 * 1000),
    });
    SCRIPT.selectResults = [[row]];
    SCRIPT.refreshHandler = async () => {
      throw new MockSpotifyError('unauthorized', 401, 'token revoked');
    };
    const result = await mod.ensureFreshUserToken('user-1');
    assert.equal(result, null);
    assert.equal(SCRIPT.updateCalls.length, 1);
    const set = SCRIPT.updateCalls[0]!.set;
    assert.equal(set.revokedReason, '401_from_spotify');
    assert.ok(set.revokedAt instanceof Date);
  });
});

describe('isSpotifyConnected', () => {
  it('returns true when an unrevoked row exists', async () => {
    SCRIPT.selectResults = [[{ userId: 'user-1' }]];
    assert.equal(await mod.isSpotifyConnected('user-1'), true);
  });

  it('returns false when no row exists', async () => {
    SCRIPT.selectResults = [[]];
    assert.equal(await mod.isSpotifyConnected('user-1'), false);
  });
});

describe('getConnectionStatus', () => {
  it('returns connected metadata when the row is live', async () => {
    SCRIPT.selectResults = [
      [
        {
          displayName: 'Phoebe',
          product: 'premium',
          spotifyUserId: 'sp-1',
          scope: 'user-follow-read',
          revokedAt: null,
        },
      ],
    ];
    const status = await mod.getConnectionStatus('user-1');
    assert.equal(status.connected, true);
    assert.equal(status.displayName, 'Phoebe');
    assert.equal(status.product, 'premium');
  });

  it('returns disconnected when the row is revoked', async () => {
    SCRIPT.selectResults = [
      [
        {
          displayName: null,
          product: null,
          spotifyUserId: 'sp-1',
          scope: 'user-follow-read',
          revokedAt: new Date(),
        },
      ],
    ];
    const status = await mod.getConnectionStatus('user-1');
    assert.equal(status.connected, false);
  });

  it('returns disconnected when no row at all', async () => {
    SCRIPT.selectResults = [[]];
    const status = await mod.getConnectionStatus('user-1');
    assert.equal(status.connected, false);
  });
});

describe('disconnectSpotify', () => {
  it('issues an update setting revokedAt + revokedReason', async () => {
    await mod.disconnectSpotify('user-1', 'user_disconnect');
    assert.equal(SCRIPT.updateCalls.length, 1);
    const set = SCRIPT.updateCalls[0]!.set;
    assert.ok(set.revokedAt instanceof Date);
    assert.equal(set.revokedReason, 'user_disconnect');
  });
});
