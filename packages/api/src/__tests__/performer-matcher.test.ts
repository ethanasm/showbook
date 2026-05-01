/**
 * Pure-function tests for performer-matcher helpers. No DB required.
 * Runnable via:
 *   pnpm --filter @showbook/api exec node --import tsx --test src/__tests__/performer-matcher.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpdate, isUniqueViolation } from '../performer-matcher';
import type { performers } from '@showbook/db';

type Performer = typeof performers.$inferSelect;

function existing(overrides: Partial<Performer> = {}): Performer {
  return {
    id: 'perf-1',
    name: 'Radiohead',
    imageUrl: null,
    ticketmasterAttractionId: null,
    musicbrainzId: null,
    ...overrides,
  } as Performer;
}

// ── buildUpdate ────────────────────────────────────────────────────────

test('buildUpdate: fills empty imageUrl from input', () => {
  const result = buildUpdate(existing(), { name: 'Radiohead', imageUrl: 'http://img/r.png' });
  assert.deepEqual(result, { imageUrl: 'http://img/r.png' });
});

test('buildUpdate: fills empty TM and MBID from input', () => {
  const result = buildUpdate(existing(), {
    name: 'Radiohead',
    tmAttractionId: 'tm-100',
    musicbrainzId: 'mbid-200',
  });
  assert.deepEqual(result, {
    ticketmasterAttractionId: 'tm-100',
    musicbrainzId: 'mbid-200',
  });
});

test('buildUpdate: preserves existing fields when input would overwrite', () => {
  const result = buildUpdate(
    existing({ imageUrl: 'http://existing.png', ticketmasterAttractionId: 'tm-old' }),
    { name: 'Radiohead', imageUrl: 'http://new.png', tmAttractionId: 'tm-new' },
  );
  // Existing fields are not overwritten — buildUpdate only fills nulls.
  assert.equal(result, null);
});

test('buildUpdate: returns null when nothing to update', () => {
  const result = buildUpdate(existing(), { name: 'Radiohead' });
  assert.equal(result, null);
});

test('buildUpdate: fills only the missing field, ignores already-set ones', () => {
  const result = buildUpdate(
    existing({ imageUrl: 'http://have.png' }),
    { name: 'Radiohead', imageUrl: 'http://other.png', tmAttractionId: 'tm-1' },
  );
  assert.deepEqual(result, { ticketmasterAttractionId: 'tm-1' });
});

// ── isUniqueViolation ───────────────────────────────────────────────────

test('isUniqueViolation: true for pg unique constraint code 23505', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true);
});

test('isUniqueViolation: false for other pg error codes', () => {
  assert.equal(isUniqueViolation({ code: '23503' }), false);
  assert.equal(isUniqueViolation({ code: '42P01' }), false);
});

test('isUniqueViolation: false for non-error values', () => {
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(undefined), false);
  assert.equal(isUniqueViolation('not an error'), false);
  assert.equal(isUniqueViolation(42), false);
});

test('isUniqueViolation: false for object without code', () => {
  assert.equal(isUniqueViolation({}), false);
  assert.equal(isUniqueViolation({ message: 'oops' }), false);
});

// drizzle-orm 0.45 wraps postgres errors in DrizzleQueryError, so the SQLSTATE
// lives on err.cause.code, not err.code. Walk the chain or the matcher's
// catch(isUniqueViolation) recovery branch silently goes dead.
test('isUniqueViolation: true when 23505 sits on err.cause (drizzle wrap)', () => {
  assert.equal(
    isUniqueViolation({ message: 'Failed query…', cause: { code: '23505' } }),
    true,
  );
});

test('isUniqueViolation: true when 23505 is two cause-levels deep', () => {
  assert.equal(
    isUniqueViolation({ cause: { cause: { code: '23505' } } }),
    true,
  );
});
