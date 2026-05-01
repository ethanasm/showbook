/**
 * Pure-function tests for venue-matcher helpers. No DB required.
 * Runnable via:
 *   pnpm --filter @showbook/api exec node --import tsx --test src/__tests__/venue-matcher.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUniqueViolation,
  matchOrCreateVenue,
  toStateCode,
  venueNameVariants,
} from '../venue-matcher';

// ── matchOrCreateVenue input guards ─────────────────────────────────────

// Plan §E: empty venue name reaches `matchOrCreateVenue` from `discover-ingest`
// for TM events that come back with no `_embedded.venues[].name` (Düsseldorf,
// 2026-04-30). The matcher used to interpolate the empty value into
// `lower(${input.name})`, producing the 0-arg SQL `lower()` and a Postgres
// `function lower() does not exist` error. Validate at the boundary so the
// failure mode is a clear typed error, not cryptic SQL.
test('matchOrCreateVenue: throws synchronously on empty name', async () => {
  await assert.rejects(
    () => matchOrCreateVenue({ name: '', city: 'Düsseldorf' }),
    /name is required/i,
  );
});

test('matchOrCreateVenue: throws synchronously on empty city', async () => {
  await assert.rejects(
    () => matchOrCreateVenue({ name: 'Warfield', city: '' }),
    /city is required/i,
  );
});

test('matchOrCreateVenue: throws synchronously on whitespace-only name', async () => {
  await assert.rejects(
    () => matchOrCreateVenue({ name: '   ', city: 'San Francisco' }),
    /name is required/i,
  );
});

// ── toStateCode ─────────────────────────────────────────────────────────

test('toStateCode: returns undefined for null/undefined input', () => {
  assert.equal(toStateCode(null), undefined);
  assert.equal(toStateCode(undefined), undefined);
  assert.equal(toStateCode(''), undefined);
});

test('toStateCode: passes through 2-letter codes (uppercased)', () => {
  assert.equal(toStateCode('CA'), 'CA');
  assert.equal(toStateCode('ny'), 'NY');
  assert.equal(toStateCode('Tx'), 'TX');
});

test('toStateCode: maps US state full names to 2-letter codes', () => {
  assert.equal(toStateCode('California'), 'CA');
  assert.equal(toStateCode('New York'), 'NY');
  assert.equal(toStateCode('North Carolina'), 'NC');
  assert.equal(toStateCode('District of Columbia'), 'DC');
});

test('toStateCode: maps Canadian provinces too', () => {
  assert.equal(toStateCode('Ontario'), 'ON');
  assert.equal(toStateCode('Quebec'), 'QC');
  assert.equal(toStateCode('British Columbia'), 'BC');
  assert.equal(toStateCode('Newfoundland and Labrador'), 'NL');
});

test('toStateCode: case-insensitive on full-name lookup', () => {
  assert.equal(toStateCode('CALIFORNIA'), 'CA');
  assert.equal(toStateCode('new york'), 'NY');
});

test('toStateCode: returns undefined for unknown long name', () => {
  assert.equal(toStateCode('Atlantis'), undefined);
  assert.equal(toStateCode('XYZ'), undefined);
});

test('toStateCode: passes through unknown 2-char as-is', () => {
  // Length-2 always uppercases without lookup, so this is a documented
  // accept-list of behavior — callers that pass 2-char garbage get garbage.
  assert.equal(toStateCode('zz'), 'ZZ');
});

// ── venueNameVariants ──────────────────────────────────────────────────

test('venueNameVariants: plain name has just one variant', () => {
  assert.deepEqual(venueNameVariants('Madison Square Garden'), [
    'Madison Square Garden',
  ]);
});

test('venueNameVariants: " at <parent>" suffix yields a stripped variant', () => {
  assert.deepEqual(venueNameVariants('Soldiers Field at Harvard'), [
    'Soldiers Field at Harvard',
    'Soldiers Field',
  ]);
});

test('venueNameVariants: " - <org>" suffix yields a stripped variant', () => {
  assert.deepEqual(venueNameVariants('Theatre - Lincoln Center'), [
    'Theatre - Lincoln Center',
    'Theatre',
  ]);
});

test('venueNameVariants: stripped variant must be at least 3 chars', () => {
  // "X at Y" → strip yields "X", which is too short — keep only original.
  assert.deepEqual(venueNameVariants('X at Lincoln Center'), [
    'X at Lincoln Center',
  ]);
});

test('venueNameVariants: case-insensitive on " at "', () => {
  assert.deepEqual(venueNameVariants('Foo Hall AT Bar College'), [
    'Foo Hall AT Bar College',
    'Foo Hall',
  ]);
});

// ── isUniqueViolation ────────────────────────────────────────────────────

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
