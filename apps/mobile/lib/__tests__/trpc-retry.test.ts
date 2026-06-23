/**
 * Unit tests for the mobile tRPC retry / transient-classification helpers.
 *
 * Pure module (no RN/Expo deps) — runs clean under node:test. These guard
 * the two behaviours that keep a transient connectivity blip from (a)
 * surfacing to the user and (b) inflating the `error_volume` health gauge.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_QUERY_RETRIES,
  isTransientTrpcError,
  shouldRetryQuery,
  trpcRetryDelay,
} from '../trpc-retry.js';

/** Build an error shaped like a tRPC client error with a resolved httpStatus. */
function trpcErr(httpStatus: number | undefined, code = ''): unknown {
  return { data: httpStatus === undefined ? undefined : { httpStatus, code } };
}

describe('isTransientTrpcError', () => {
  it('treats a transport failure with no httpStatus as transient', () => {
    // The 2026-06-22 burst: no tRPC response reached the client.
    assert.equal(isTransientTrpcError(new Error('The network connection was lost.')), true);
    assert.equal(isTransientTrpcError(new TypeError('fetch failed')), true);
    assert.equal(
      isTransientTrpcError(new Error('JSON Parse error: Unexpected character: <')),
      true,
    );
    assert.equal(isTransientTrpcError(trpcErr(undefined)), true);
    assert.equal(isTransientTrpcError(null), true);
    assert.equal(isTransientTrpcError(undefined), true);
  });

  it('treats 5xx and the retryable 4xx statuses as transient', () => {
    for (const s of [500, 502, 503, 504, 408, 425, 429]) {
      assert.equal(isTransientTrpcError(trpcErr(s)), true, `status ${s} should be transient`);
    }
  });

  it('treats genuine 4xx rejections as non-transient', () => {
    assert.equal(isTransientTrpcError(trpcErr(401, 'UNAUTHORIZED')), false);
    assert.equal(isTransientTrpcError(trpcErr(403, 'FORBIDDEN')), false);
    assert.equal(isTransientTrpcError(trpcErr(404, 'NOT_FOUND')), false);
    assert.equal(isTransientTrpcError(trpcErr(400, 'BAD_REQUEST')), false);
  });
});

describe('shouldRetryQuery', () => {
  it('retries transient failures up to MAX_QUERY_RETRIES times', () => {
    const transient = trpcErr(503);
    for (let i = 0; i < MAX_QUERY_RETRIES; i++) {
      assert.equal(shouldRetryQuery(i, transient), true, `failureCount ${i} should retry`);
    }
    // 0-indexed failureCount, checked before increment → exactly N retries.
    assert.equal(shouldRetryQuery(MAX_QUERY_RETRIES, transient), false);
  });

  it('never retries a non-transient (4xx) failure', () => {
    assert.equal(shouldRetryQuery(0, trpcErr(401, 'UNAUTHORIZED')), false);
    assert.equal(shouldRetryQuery(0, trpcErr(404, 'NOT_FOUND')), false);
  });
});

describe('trpcRetryDelay', () => {
  it('uses capped exponential backoff (0.5s, 1s, 2s … cap 4s)', () => {
    assert.equal(trpcRetryDelay(0), 500);
    assert.equal(trpcRetryDelay(1), 1000);
    assert.equal(trpcRetryDelay(2), 2000);
    assert.equal(trpcRetryDelay(3), 4000);
    assert.equal(trpcRetryDelay(10), 4000);
  });
});
