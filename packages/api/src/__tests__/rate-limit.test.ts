/**
 * Unit tests for the in-memory rate limit helpers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { enforceRateLimit, isRateLimited } from '../rate-limit';

describe('rate-limit', () => {
  it('isRateLimited returns false until the bucket fills', () => {
    const key = `ratelimit-test-${Math.random()}`;
    const opts = { max: 3, windowMs: 60_000 };
    assert.equal(isRateLimited(key, opts), false);
    assert.equal(isRateLimited(key, opts), false);
    assert.equal(isRateLimited(key, opts), false);
    assert.equal(isRateLimited(key, opts), true);
  });

  it('enforceRateLimit throws TOO_MANY_REQUESTS once exceeded', () => {
    const key = `enforce-test-${Math.random()}`;
    const opts = { max: 1, windowMs: 60_000 };
    enforceRateLimit(key, opts);
    assert.throws(
      () => enforceRateLimit(key, opts),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });
});
