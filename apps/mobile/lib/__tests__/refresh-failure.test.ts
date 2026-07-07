/**
 * Unit tests for `lib/refresh-failure.ts` — the pure helpers that turn a
 * React Query `refetch()` resolution into a classified, user-facing
 * refresh failure. The classification mirrors the two prod incidents that
 * motivated the module: the 2026-07-06 server outage (transport failures →
 * `unreachable`) and the 2026-07-05 expired-session UNAUTHORIZED burst
 * (`session-expired`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRefreshFailure,
  firstRefetchError,
  refreshFailureMessage,
} from '../refresh-failure';

/** Shape a TRPCClientError exposes to consumers. */
function trpcErr(httpStatus?: number, code?: string): Error {
  const err = new Error(code ?? 'error') as Error & {
    data?: { httpStatus?: number; code?: string };
  };
  err.data = { httpStatus, code };
  return err;
}

describe('firstRefetchError', () => {
  it('returns undefined for a successful refetch result', () => {
    assert.equal(firstRefetchError({ status: 'success', data: [] }), undefined);
  });

  it('returns undefined for void / primitive resolutions', () => {
    assert.equal(firstRefetchError(undefined), undefined);
    assert.equal(firstRefetchError(null), undefined);
    assert.equal(firstRefetchError(42), undefined);
  });

  it('extracts the error from a failed refetch result', () => {
    const boom = new Error('boom');
    assert.equal(firstRefetchError({ status: 'error', error: boom }), boom);
    assert.equal(firstRefetchError({ isError: true, error: boom }), boom);
  });

  it('never returns undefined for a failed result missing its error', () => {
    const err = firstRefetchError({ status: 'error' });
    assert.ok(err instanceof Error);
  });

  it('walks Promise.all-style arrays and returns the first failure', () => {
    const first = new Error('first');
    const second = new Error('second');
    const err = firstRefetchError([
      undefined, // invalidate() resolution
      { status: 'success', data: 1 },
      { status: 'error', error: first },
      { status: 'error', error: second },
    ]);
    assert.equal(err, first);
  });

  it('returns undefined for an all-success array', () => {
    assert.equal(
      firstRefetchError([{ status: 'success' }, { status: 'success' }]),
      undefined,
    );
  });
});

describe('classifyRefreshFailure', () => {
  it('classifies 401 / UNAUTHORIZED as session-expired', () => {
    assert.equal(classifyRefreshFailure(trpcErr(401, 'UNAUTHORIZED')), 'session-expired');
    assert.equal(classifyRefreshFailure(trpcErr(401)), 'session-expired');
    assert.equal(classifyRefreshFailure(trpcErr(undefined, 'UNAUTHORIZED')), 'session-expired');
  });

  it('classifies transport failures (no httpStatus) as unreachable', () => {
    // fetch failed / connection reset — no decodable tRPC response.
    assert.equal(classifyRefreshFailure(new TypeError('fetch failed')), 'unreachable');
  });

  it('classifies retryable 5xx as unreachable', () => {
    assert.equal(classifyRefreshFailure(trpcErr(502, 'INTERNAL_SERVER_ERROR')), 'unreachable');
    assert.equal(classifyRefreshFailure(trpcErr(503)), 'unreachable');
  });

  it('classifies other 4xx application rejections as plain errors', () => {
    assert.equal(classifyRefreshFailure(trpcErr(403, 'FORBIDDEN')), 'error');
    assert.equal(classifyRefreshFailure(trpcErr(404, 'NOT_FOUND')), 'error');
    assert.equal(classifyRefreshFailure(trpcErr(400, 'BAD_REQUEST')), 'error');
  });
});

describe('refreshFailureMessage', () => {
  it('has a distinct, non-empty message per kind', () => {
    const messages = (['session-expired', 'unreachable', 'error'] as const).map(
      refreshFailureMessage,
    );
    for (const m of messages) {
      assert.ok(m.length > 0);
    }
    assert.equal(new Set(messages).size, messages.length);
  });

  it('tells the user to sign in again when the session expired', () => {
    assert.match(refreshFailureMessage('session-expired'), /sign in/i);
  });
});
