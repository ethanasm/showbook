import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let signUnsubscribeToken: typeof import('../unsubscribe-token').signUnsubscribeToken;
let verifyUnsubscribeToken: typeof import('../unsubscribe-token').verifyUnsubscribeToken;

before(async () => {
  process.env.AUTH_SECRET ??= 'test-auth-secret-for-unsubscribe-token';
  const mod = await import('../unsubscribe-token');
  signUnsubscribeToken = mod.signUnsubscribeToken;
  verifyUnsubscribeToken = mod.verifyUnsubscribeToken;
});

describe('unsubscribe-token', () => {
  it('round-trips a userId through sign + verify', () => {
    const userId = 'user_abc123';
    const token = signUnsubscribeToken(userId);
    assert.equal(verifyUnsubscribeToken(token), userId);
  });

  it('rejects a token signed with a different secret', () => {
    const originalSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'first-secret';
    const token = signUnsubscribeToken('user_x');
    process.env.AUTH_SECRET = 'second-secret';
    assert.equal(verifyUnsubscribeToken(token), null);
    process.env.AUTH_SECRET = originalSecret;
  });

  it('rejects a tampered userId payload', () => {
    const token = signUnsubscribeToken('user_a');
    // Flip the userId but keep the signature — the recomputed HMAC
    // over the modified userId will not match.
    const sepIdx = token.lastIndexOf('.');
    const sig = token.slice(sepIdx);
    const tampered = `user_b${sig}`;
    assert.equal(verifyUnsubscribeToken(tampered), null);
  });

  it('rejects a tampered signature', () => {
    const token = signUnsubscribeToken('user_a');
    // Flip the last hex digit of the signature.
    const last = token.slice(-1);
    const flipped = token.slice(0, -1) + (last === 'f' ? '0' : 'f');
    assert.equal(verifyUnsubscribeToken(flipped), null);
  });

  it('rejects malformed shapes', () => {
    assert.equal(verifyUnsubscribeToken(''), null);
    assert.equal(verifyUnsubscribeToken('nodotinhere'), null);
    assert.equal(verifyUnsubscribeToken('.justasignature'), null);
    assert.equal(verifyUnsubscribeToken('justauserid.'), null);
  });
});
