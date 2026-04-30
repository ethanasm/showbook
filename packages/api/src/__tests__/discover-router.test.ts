/**
 * Unit tests for the discover router. Most procedures use the imported
 * `db` directly (not `ctx.db`), so end-to-end paths live in
 * nearby-feed.integration.test.ts. What's covered here:
 *   - cursor encode/decode round-trip + malformed input
 *   - searchArtists swallowing upstream errors → []
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCursor,
  decodeCursor,
  discoverRouter,
} from '../routers/discover';
import { makeFakeDb, fakeCtx, type FakeDb } from './_fake-db';

function caller(db: FakeDb, userId = 'test-user') {
  return discoverRouter.createCaller(fakeCtx(db, userId) as never);
}

describe('discover cursor helpers (unit)', () => {
  it('encode/decode round-trips', () => {
    const encoded = encodeCursor('2026-08-01', 'abc-123');
    const decoded = decodeCursor(encoded);
    assert.deepEqual(decoded, { showDate: '2026-08-01', id: 'abc-123' });
  });

  it('decodeCursor returns null for undefined', () => {
    assert.equal(decodeCursor(undefined), null);
  });

  it('decodeCursor returns null when not exactly two parts', () => {
    assert.equal(decodeCursor('only-one'), null);
    assert.equal(decodeCursor('a|b|c'), null);
  });

  it('decodeCursor returns null when either part is empty', () => {
    assert.equal(decodeCursor('|abc'), null);
    assert.equal(decodeCursor('2026-01-01|'), null);
  });
});

describe('discoverRouter.searchArtists (unit)', () => {
  it('returns [] when the TM client throws', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network down (test stub)');
    }) as typeof globalThis.fetch;
    try {
      const db = makeFakeDb();
      const result = await caller(db).searchArtists({
        keyword: 'unique-test-keyword',
      });
      assert.deepEqual(result, []);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('rejects empty keyword (zod min(1))', async () => {
    const db = makeFakeDb();
    await assert.rejects(() => caller(db).searchArtists({ keyword: '' }));
  });
});
