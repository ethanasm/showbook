/**
 * AES-256-GCM helpers for at-rest encryption of OAuth tokens. The only
 * caller in Phase 0 is `spotify-tokens.ts` (Spotify access + refresh
 * tokens), but the helpers are deliberately generic so other persisted
 * provider tokens (Apple Music, Gmail, etc.) can adopt the same store
 * without forking the crypto.
 *
 * Format: a single base64 string holding `iv (12) | tag (16) | ciphertext`.
 * Decoupling from the storage layer (one column, one base64 string) keeps
 * the schema cheap and makes key rotation a self-contained re-encrypt loop
 * per row.
 *
 * Key source: `process.env.TOKEN_KEY` — a 32-byte hex string set per
 * environment. Decoded once at boot via `getKey()`. Tests can override
 * with `TOKEN_KEY` set to a known fixture.
 *
 * Failure model: any tampering (wrong tag, truncated ciphertext, garbage
 * input) throws `CryptoError`. Callers should treat this as "token is
 * unrecoverable" — always fall back to re-prompting the user, never paper
 * over with an empty string.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM-recommended IV size
const TAG_BYTES = 16;
const KEY_BYTES = 32; // 256-bit key

export class CryptoError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'CryptoError';
  }
}

let cachedKey: Buffer | null = null;

/**
 * Resolve the AES key from env. Decoded once and cached. Reset between
 * test runs by importing `__resetKeyCacheForTests` and calling it from a
 * `beforeEach` (the prod path never re-resolves).
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TOKEN_KEY;
  if (!raw) {
    throw new CryptoError(
      'TOKEN_KEY env var is not set — encryption helpers cannot run',
    );
  }
  // Accept hex (preferred) or base64. Hex is 64 chars; base64 of 32 bytes
  // is 44 chars (with padding) or 43 (without). Detect by length to avoid
  // a quiet mis-parse.
  let key: Buffer;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === KEY_BYTES * 2) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      `TOKEN_KEY must decode to ${KEY_BYTES} bytes; got ${key.length}`,
    );
  }
  cachedKey = key;
  return key;
}

export function __resetKeyCacheForTests(): void {
  cachedKey = null;
}

/**
 * Encrypt a UTF-8 plaintext into a base64-encoded `iv|tag|ciphertext`
 * blob suitable for storage in a single text column.
 */
export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new CryptoError('encrypt() requires a string plaintext');
  }
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypt the inverse of `encrypt`. Throws `CryptoError` on any tampering
 * or malformed input — callers should treat the row as unrecoverable.
 */
export function decrypt(encoded: string): string {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new CryptoError('decrypt() requires a non-empty string');
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(encoded, 'base64');
  } catch (err) {
    throw new CryptoError('decrypt() input is not valid base64', err);
  }
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new CryptoError('decrypt() input is too short to contain iv+tag+ciphertext');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch (err) {
    throw new CryptoError('decrypt() authentication failed', err);
  }
}
