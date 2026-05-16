/**
 * Unit tests for `packages/api/src/crypto.ts`. Sets a deterministic
 * `TOKEN_KEY` per test, then resets the in-module cache so length /
 * encoding / tampering paths can be exercised independently.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CryptoError,
  __resetKeyCacheForTests,
  decrypt,
  encrypt,
} from '../crypto';

const VALID_KEY_HEX = 'a'.repeat(64); // 32 bytes hex
const VALID_KEY_HEX_OTHER = 'b'.repeat(64);

let origKey: string | undefined;

beforeEach(() => {
  origKey = process.env.TOKEN_KEY;
  process.env.TOKEN_KEY = VALID_KEY_HEX;
  __resetKeyCacheForTests();
});

afterEach(() => {
  if (origKey === undefined) delete process.env.TOKEN_KEY;
  else process.env.TOKEN_KEY = origKey;
  __resetKeyCacheForTests();
});

describe('crypto encrypt/decrypt round-trip', () => {
  it('round-trips a UTF-8 plaintext', () => {
    const plain = 'spotify-access-token-' + 'x'.repeat(120);
    const enc = encrypt(plain);
    assert.notEqual(enc, plain, 'ciphertext must differ from plaintext');
    assert.equal(decrypt(enc), plain);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plain = 'token-xyz';
    const a = encrypt(plain);
    const b = encrypt(plain);
    assert.notEqual(a, b, 'IV-randomness should produce distinct outputs');
    assert.equal(decrypt(a), plain);
    assert.equal(decrypt(b), plain);
  });

  it('round-trips an empty string', () => {
    const enc = encrypt('');
    assert.equal(decrypt(enc), '');
  });

  it('round-trips multibyte UTF-8 (emoji, accented chars)', () => {
    const plain = '🎵 Phoebe Bridgers — Punisher (live)';
    const enc = encrypt(plain);
    assert.equal(decrypt(enc), plain);
  });
});

describe('crypto failure modes', () => {
  it('throws CryptoError when TOKEN_KEY is missing', () => {
    delete process.env.TOKEN_KEY;
    __resetKeyCacheForTests();
    assert.throws(
      () => encrypt('x'),
      (err: unknown) =>
        err instanceof CryptoError && /TOKEN_KEY/.test(err.message),
    );
  });

  it('throws CryptoError when TOKEN_KEY decodes to wrong byte length', () => {
    process.env.TOKEN_KEY = 'a'.repeat(63); // 31.5 bytes — rejected by hex+length check
    __resetKeyCacheForTests();
    assert.throws(
      () => encrypt('x'),
      (err: unknown) =>
        err instanceof CryptoError && /must decode to 32 bytes/.test(err.message),
    );
  });

  it('rejects empty / non-string decrypt input', () => {
    assert.throws(() => decrypt(''), (err: unknown) => err instanceof CryptoError);
    // @ts-expect-error — intentional malformed input for the runtime guard
    assert.throws(() => decrypt(undefined), (err: unknown) => err instanceof CryptoError);
  });

  it('rejects truncated ciphertext', () => {
    assert.throws(
      () => decrypt('YWFh'), // base64 of "aaa" — far too short
      (err: unknown) => err instanceof CryptoError,
    );
  });

  it('rejects ciphertext encrypted under a different key (auth tag fails)', () => {
    const enc = encrypt('secret');
    process.env.TOKEN_KEY = VALID_KEY_HEX_OTHER;
    __resetKeyCacheForTests();
    assert.throws(
      () => decrypt(enc),
      (err: unknown) =>
        err instanceof CryptoError && /authentication failed/.test(err.message),
    );
  });

  it('rejects tampered ciphertext (flipped byte in payload)', () => {
    const enc = encrypt('hello');
    const buf = Buffer.from(enc, 'base64');
    // Flip a byte in the ciphertext region (after iv+tag).
    buf[buf.length - 1] = (buf[buf.length - 1]! ^ 0xff) & 0xff;
    const tampered = buf.toString('base64');
    assert.throws(
      () => decrypt(tampered),
      (err: unknown) => err instanceof CryptoError,
    );
  });
});
