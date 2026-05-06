/**
 * Unit tests for apple-music.ts. Stubs globalThis.fetch with canned
 * responses; no real Apple Music API calls happen. Developer-token
 * signing is exercised against a freshly-generated P-256 key per test.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  verify as cryptoVerify,
} from 'node:crypto';
import {
  AppleMusicError,
  AppleMusicConfigError,
  getDeveloperToken,
  getLibraryArtists,
  signDeveloperToken,
  _resetDeveloperTokenCacheForTests,
} from '../apple-music';

let origFetch: typeof globalThis.fetch;
const ENV_KEYS = [
  'APPLE_MUSIC_TEAM_ID',
  'APPLE_MUSIC_KEY_ID',
  'APPLE_MUSIC_PRIVATE_KEY',
] as const;
const origEnv: Record<string, string | undefined> = {};

function generateP256Pem(): { privatePem: string; publicKey: ReturnType<typeof createPublicKey> } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const publicKey = createPublicKey(createPrivateKey(privatePem));
  return { privatePem, publicKey };
}

beforeEach(() => {
  origFetch = globalThis.fetch;
  for (const k of ENV_KEYS) origEnv[k] = process.env[k];
  _resetDeveloperTokenCacheForTests();
});
afterEach(() => {
  globalThis.fetch = origFetch;
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
  _resetDeveloperTokenCacheForTests();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AppleMusicError', () => {
  it('captures message + status + detail', () => {
    const err = new AppleMusicError('boom', 401, 'expired');
    assert.equal(err.name, 'AppleMusicError');
    assert.equal(err.status, 401);
    assert.equal(err.detail, 'expired');
    assert.ok(err instanceof Error);
  });
});

describe('signDeveloperToken', () => {
  it('produces a JWT verifiable with the matching public key', () => {
    const { privatePem, publicKey } = generateP256Pem();
    const now = 1_700_000_000;
    const token = signDeveloperToken(
      { teamId: 'TEAM123', keyId: 'KEY456', privateKey: privatePem },
      now,
      3600,
    );
    const [headerB64, payloadB64, sigB64] = token.split('.');
    assert.ok(headerB64 && payloadB64 && sigB64);

    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    assert.equal(header.alg, 'ES256');
    assert.equal(header.kid, 'KEY456');
    assert.equal(payload.iss, 'TEAM123');
    assert.equal(payload.iat, now);
    assert.equal(payload.exp, now + 3600);

    const ok = cryptoVerify(
      'sha256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(sigB64, 'base64url'),
    );
    assert.equal(ok, true);
  });

  it('signature is JOSE-format (64 raw bytes), not DER', () => {
    const { privatePem } = generateP256Pem();
    const token = signDeveloperToken(
      { teamId: 'T', keyId: 'K', privateKey: privatePem },
      1_700_000_000,
      60,
    );
    const sigB64 = token.split('.')[2]!;
    const sig = Buffer.from(sigB64, 'base64url');
    // P-256 ECDSA in IEEE P1363 / JOSE form is exactly r||s = 32+32 bytes.
    assert.equal(sig.length, 64);
  });
});

describe('getDeveloperToken', () => {
  it('throws AppleMusicConfigError when env vars are unset', () => {
    delete process.env.APPLE_MUSIC_TEAM_ID;
    delete process.env.APPLE_MUSIC_KEY_ID;
    delete process.env.APPLE_MUSIC_PRIVATE_KEY;
    assert.throws(() => getDeveloperToken(), AppleMusicConfigError);
  });

  it('caches the signed token across calls until near expiry', () => {
    const { privatePem } = generateP256Pem();
    process.env.APPLE_MUSIC_TEAM_ID = 'T';
    process.env.APPLE_MUSIC_KEY_ID = 'K';
    process.env.APPLE_MUSIC_PRIVATE_KEY = privatePem;
    const t1 = getDeveloperToken();
    const t2 = getDeveloperToken();
    assert.equal(t1, t2);
  });

  it('accepts PEM with literal \\n escapes (env-file form)', () => {
    const { privatePem } = generateP256Pem();
    process.env.APPLE_MUSIC_TEAM_ID = 'T';
    process.env.APPLE_MUSIC_KEY_ID = 'K';
    process.env.APPLE_MUSIC_PRIVATE_KEY = privatePem.replace(/\n/g, '\\n');
    assert.doesNotThrow(() => getDeveloperToken());
  });
});

describe('getLibraryArtists', () => {
  it('returns artists from a single page with names extracted', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        data: [
          {
            id: 'r.abc',
            type: 'library-artists',
            attributes: { name: 'Phoebe Bridgers' },
          },
        ],
      })) as typeof globalThis.fetch;

    const result = await getLibraryArtists('dev-tok', 'mut-tok');
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, 'r.abc');
    assert.equal(result[0]?.name, 'Phoebe Bridgers');
    assert.equal(result[0]?.imageUrl, null);
    assert.deepEqual(result[0]?.genres, []);
  });

  it('follows the `next` path and concatenates pages', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          data: [
            { id: 'a1', type: 'library-artists', attributes: { name: 'One' } },
          ],
          next: '/v1/me/library/artists?offset=100',
        });
      }
      return jsonResponse({
        data: [
          { id: 'a2', type: 'library-artists', attributes: { name: 'Two' } },
        ],
      });
    }) as typeof globalThis.fetch;

    const result = await getLibraryArtists('dev', 'mut');
    assert.equal(result.length, 2);
    assert.equal(calls, 2);
  });

  it('passes both Authorization and Music-User-Token headers', async () => {
    let captured: Record<string, string> | null = null;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      captured = init?.headers as Record<string, string>;
      return jsonResponse({ data: [] });
    }) as typeof globalThis.fetch;

    await getLibraryArtists('my-dev-token', 'my-music-user-token');
    assert.equal(captured!.Authorization, 'Bearer my-dev-token');
    assert.equal(captured!['Music-User-Token'], 'my-music-user-token');
  });

  it('skips items missing attributes.name', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        data: [
          { id: 'a1', type: 'library-artists' },
          { id: 'a2', type: 'library-artists', attributes: {} },
          { id: 'a3', type: 'library-artists', attributes: { name: 'Real' } },
        ],
      })) as typeof globalThis.fetch;

    const result = await getLibraryArtists('d', 'm');
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, 'a3');
  });

  it('throws AppleMusicError on non-OK responses', async () => {
    globalThis.fetch = (async () =>
      new Response('expired', { status: 401 })) as typeof globalThis.fetch;

    await assert.rejects(
      getLibraryArtists('d', 'm'),
      (err: AppleMusicError) => {
        assert.equal(err.name, 'AppleMusicError');
        assert.equal(err.status, 401);
        assert.equal(err.detail, 'expired');
        return true;
      },
    );
  });

  it('caps at 1000 artists even if Apple keeps paging', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        data: Array.from({ length: 100 }, (_, i) => ({
          id: `a${i}`,
          type: 'library-artists',
          attributes: { name: `Artist ${i}` },
        })),
        next: '/v1/me/library/artists?offset=x',
      })) as typeof globalThis.fetch;

    const result = await getLibraryArtists('d', 'm');
    assert.equal(result.length, 1000);
  });

  it('handles empty data array gracefully', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ data: [] })) as typeof globalThis.fetch;
    const result = await getLibraryArtists('d', 'm');
    assert.equal(result.length, 0);
  });
});
