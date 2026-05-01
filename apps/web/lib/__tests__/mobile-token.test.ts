/**
 * Unit tests for apps/web/lib/mobile-token.ts
 *
 * All tests are pure / fast — no real DB or HTTP calls. verifyGoogleIdToken
 * accepts an optional `client` arg for dependency injection (avoids mock.module
 * which is unavailable in this Node + tsx environment).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeMobileToken,
  decodeMobileToken,
  verifyGoogleIdToken,
  upsertUserFromGoogle,
  MOBILE_JWT_SALT,
  type GoogleOAuth2Client,
  type GoogleIdTokenPayload,
} from '../mobile-token';
import type { Database } from '@showbook/db';

const TEST_SECRET = 'super-secret-for-tests-at-least-32-chars!!';

// ---------------------------------------------------------------------------
// encodeMobileToken + decodeMobileToken — round-trip
// ---------------------------------------------------------------------------
describe('encodeMobileToken / decodeMobileToken', () => {
  it('round-trip: encodes then decodes and returns the same id', async () => {
    const userId = 'user-abc-123';
    const token = await encodeMobileToken({
      userId,
      email: 'alice@example.com',
      name: 'Alice',
      image: null,
      secret: TEST_SECRET,
    });

    assert.equal(typeof token, 'string');
    assert.ok(token.length > 0, 'token should be a non-empty string');

    const decoded = await decodeMobileToken({ token, secret: TEST_SECRET });
    assert.ok(decoded !== null, 'decoded should not be null');
    assert.equal(decoded!.id, userId);
  });

  it('round-trip includes correct user id even with null name/image', async () => {
    const userId = 'user-no-name';
    const token = await encodeMobileToken({
      userId,
      email: 'noname@example.com',
      name: null,
      image: null,
      secret: TEST_SECRET,
    });
    const decoded = await decodeMobileToken({ token, secret: TEST_SECRET });
    assert.ok(decoded !== null);
    assert.equal(decoded!.id, userId);
  });

  it('returns null for a token signed with a different secret', async () => {
    const token = await encodeMobileToken({
      userId: 'user-xyz',
      email: 'bob@example.com',
      name: null,
      image: null,
      secret: TEST_SECRET,
    });

    const decoded = await decodeMobileToken({
      token,
      secret: 'completely-different-secret-12345!',
    });
    assert.equal(decoded, null);
  });

  it('returns null for a malformed / garbage token string', async () => {
    const decoded = await decodeMobileToken({ token: 'notavalidjwt', secret: TEST_SECRET });
    assert.equal(decoded, null);
  });

  it('returns null for an empty token string', async () => {
    const decoded = await decodeMobileToken({ token: '', secret: TEST_SECRET });
    assert.equal(decoded, null);
  });

  it('uses MOBILE_JWT_SALT — a token encoded with the wrong salt decodes to null', async () => {
    // Encode with a different salt (simulating a cookie-bound token)
    const { encode } = await import('next-auth/jwt');
    const wrongSaltToken = await encode({
      token: { sub: 'user-wrong-salt', id: 'user-wrong-salt', email: 'x@x.com' },
      secret: TEST_SECRET,
      salt: '__Secure-authjs.session-token', // wrong salt
    });

    const decoded = await decodeMobileToken({ token: wrongSaltToken, secret: TEST_SECRET });
    // Should be null because salt mismatch means decryption fails
    assert.equal(decoded, null, 'token with wrong salt should not decode');
  });
});

// ---------------------------------------------------------------------------
// verifyGoogleIdToken — using dependency injection for the OAuth2Client
// ---------------------------------------------------------------------------
describe('verifyGoogleIdToken', () => {
  function makeClient(payload: GoogleIdTokenPayload | null | undefined): GoogleOAuth2Client {
    return {
      async verifyIdToken(_opts) {
        return { getPayload: () => payload };
      },
    };
  }

  function makeThrowingClient(message: string): GoogleOAuth2Client {
    return {
      async verifyIdToken(_opts) {
        throw new Error(message);
      },
    };
  }

  it('happy path: returns mapped payload for a valid ticket', async () => {
    const client = makeClient({
      sub: 'google-sub-001',
      email: 'dave@example.com',
      email_verified: true,
      name: 'Dave',
      picture: 'https://example.com/photo.jpg',
    });

    const result = await verifyGoogleIdToken('fake-id-token', ['aud1', 'aud2'], client);

    assert.deepEqual(result, {
      sub: 'google-sub-001',
      email: 'dave@example.com',
      emailVerified: true,
      name: 'Dave',
      image: 'https://example.com/photo.jpg',
    });
  });

  it('propagates errors thrown by verifyIdToken', async () => {
    const client = makeThrowingClient('Token has been expired or revoked');

    await assert.rejects(
      () => verifyGoogleIdToken('bad-token', ['aud1'], client),
      /Token has been expired or revoked/,
    );
  });

  it('throws when sub is missing from payload', async () => {
    const client = makeClient({ email: 'eve@example.com', email_verified: true });

    await assert.rejects(
      () => verifyGoogleIdToken('incomplete-token', ['aud1'], client),
      /missing required claims/,
    );
  });

  it('throws when email is missing from payload', async () => {
    const client = makeClient({ sub: 'google-sub-003', email_verified: true });

    await assert.rejects(
      () => verifyGoogleIdToken('incomplete-token-2', ['aud1'], client),
      /missing required claims/,
    );
  });

  it('maps missing name/picture to null', async () => {
    const client = makeClient({
      sub: 'google-sub-002',
      email: 'frank@example.com',
      email_verified: true,
      // name and picture intentionally absent
    });

    const result = await verifyGoogleIdToken('no-name-token', ['aud1'], client);
    assert.equal(result.name, null);
    assert.equal(result.image, null);
  });

  it('maps email_verified false to false', async () => {
    const client = makeClient({
      sub: 'google-sub-004',
      email: 'gwen@example.com',
      email_verified: false,
    });

    const result = await verifyGoogleIdToken('unverified-token', ['aud1'], client);
    assert.equal(result.emailVerified, false);
  });

  it('maps undefined email_verified to false', async () => {
    const client = makeClient({
      sub: 'google-sub-005',
      email: 'hal@example.com',
      // email_verified absent — happens with some token types
    });

    const result = await verifyGoogleIdToken('no-verified-token', ['aud1'], client);
    assert.equal(result.emailVerified, false);
  });

  it('throws when getPayload returns null', async () => {
    const client = makeClient(null);

    await assert.rejects(
      () => verifyGoogleIdToken('null-payload-token', ['aud1'], client),
      /missing required claims/,
    );
  });
});

// ---------------------------------------------------------------------------
// upsertUserFromGoogle — fake DB via dependency injection
// ---------------------------------------------------------------------------
describe('upsertUserFromGoogle', () => {
  /**
   * Build a minimal fake Database object. Only the paths exercised by
   * upsertUserFromGoogle need to be implemented; everything else can throw.
   */
  function makeFakeDb(opts: {
    existingAccount?: { userId: string } | null;
    existingUser?: { id: string; email: string | null; name: string | null; image: string | null } | null;
    insertedUser?: { id: string; email: string | null; name: string | null; image: string | null };
    onInsertAccounts?: () => void;
  }) {
    const insertedUser = opts.insertedUser ?? {
      id: 'new-user-id',
      email: 'new@example.com',
      name: 'New',
      image: null,
    };

    // Track insert calls: first call = users table, second = accounts table
    let insertCallIndex = 0;

    return {
      query: {
        accounts: {
          findFirst: async (_q: unknown) => opts.existingAccount ?? null,
        },
        users: {
          findFirst: async (_q: unknown) => opts.existingUser ?? null,
        },
      },
      insert: (_table: unknown) => ({
        values: (_values: unknown) => ({
          returning: async () => {
            const callIdx = insertCallIndex++;
            if (callIdx === 0) {
              // First insert: users table → return the new user
              return [insertedUser];
            }
            // Subsequent inserts: accounts table → no returning needed
            opts.onInsertAccounts?.();
            return [];
          },
        }),
      }),
    } as unknown as Database;
  }

  it('returns existing user when account already exists (no insert)', async () => {
    let insertCalled = false;

    const fakeDb = {
      query: {
        accounts: {
          findFirst: async (_q: unknown) => ({ userId: 'existing-user-id' }),
        },
        users: {
          findFirst: async (_q: unknown) => ({
            id: 'existing-user-id',
            email: 'grace@example.com',
            name: 'Grace',
            image: 'https://example.com/grace.jpg',
          }),
        },
      },
      insert: (_t: unknown) => {
        insertCalled = true;
        return {
          values: (_v: unknown) => ({ returning: async () => [] }),
        };
      },
    } as unknown as Database;

    const result = await upsertUserFromGoogle({
      db: fakeDb,
      googleSub: 'google-sub-existing',
      email: 'grace@example.com',
      name: 'Grace',
      image: 'https://example.com/grace.jpg',
      emailVerified: true,
    });

    assert.equal(result.id, 'existing-user-id');
    assert.equal(result.email, 'grace@example.com');
    assert.equal(result.name, 'Grace');
    assert.equal(insertCalled, false, 'should not insert for existing account');
  });

  it('inserts user + account rows when no account exists', async () => {
    let insertCallCount = 0;

    const insertedUser = { id: 'brand-new-user', email: 'henry@example.com', name: 'Henry', image: null };

    const fakeDb = {
      query: {
        accounts: { findFirst: async (_q: unknown) => null },
        users: { findFirst: async (_q: unknown) => null },
      },
      insert: (_table: unknown) => {
        const callIdx = insertCallCount++;
        if (callIdx === 0) {
          // users insert — needs .returning()
          return {
            values: (_v: unknown) => ({
              returning: async () => [insertedUser],
            }),
          };
        }
        // accounts insert — awaited directly (no .returning())
        return {
          values: (_v: unknown) => Promise.resolve([]),
        };
      },
    } as unknown as Database;

    const result = await upsertUserFromGoogle({
      db: fakeDb,
      googleSub: 'google-sub-new',
      email: 'henry@example.com',
      name: 'Henry',
      image: null,
      emailVerified: true,
    });

    assert.equal(result.id, 'brand-new-user');
    assert.equal(result.email, 'henry@example.com');
    assert.equal(insertCallCount, 2, 'should call insert twice (users + accounts)');
  });

  it('second call with same googleSub returns same userId without inserting', async () => {
    // Simulate the second call: account already exists after first insert
    let insertCalled = false;

    const fakeDb = {
      query: {
        accounts: {
          findFirst: async (_q: unknown) => ({ userId: 'idempotent-user-id' }),
        },
        users: {
          findFirst: async (_q: unknown) => ({
            id: 'idempotent-user-id',
            email: 'iris@example.com',
            name: 'Iris',
            image: null,
          }),
        },
      },
      insert: (_t: unknown) => {
        insertCalled = true;
        return {
          values: (_v: unknown) => ({ returning: async () => [] }),
        };
      },
    } as unknown as Database;

    const result1 = await upsertUserFromGoogle({
      db: fakeDb,
      googleSub: 'google-sub-idempotent',
      email: 'iris@example.com',
      name: 'Iris',
      image: null,
      emailVerified: true,
    });

    const result2 = await upsertUserFromGoogle({
      db: fakeDb,
      googleSub: 'google-sub-idempotent',
      email: 'iris@example.com',
      name: 'Iris',
      image: null,
      emailVerified: true,
    });

    assert.equal(result1.id, 'idempotent-user-id');
    assert.equal(result2.id, 'idempotent-user-id');
    assert.equal(insertCalled, false, 'should not insert on second call when account exists');
  });

  it('throws when account exists but user row is missing (data integrity failure)', async () => {
    const fakeDb = {
      query: {
        accounts: {
          findFirst: async (_q: unknown) => ({ userId: 'orphan-account-user' }),
        },
        users: {
          findFirst: async (_q: unknown) => null, // user row missing!
        },
      },
      insert: (_t: unknown) => ({
        values: (_v: unknown) => ({ returning: async () => [] }),
      }),
    } as unknown as Database;

    await assert.rejects(
      () =>
        upsertUserFromGoogle({
          db: fakeDb,
          googleSub: 'google-sub-orphan',
          email: 'jane@example.com',
          name: null,
          image: null,
          emailVerified: true,
        }),
      /user.*missing/i,
    );
  });
});
