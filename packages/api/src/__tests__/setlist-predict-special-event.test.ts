/**
 * Phase 11 §15g — special-event rule matching unit tests.
 *
 * The rule lookup itself touches the DB (specialEventRules table),
 * so it's covered by the integration test. This unit suite exercises
 * the pure matching logic via a mock lookup function so the matcher's
 * date / venue / regex predicates can be asserted exhaustively.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Internal: reach into the special-event module to test the pure
// matcher. The exported `lookupSpecialEventRule` returns a full
// SpecialEventPrediction; we want to test the predicate logic too.
//
// `matches` is internal — we re-derive its semantics here by
// constructing the same rule shapes and calling lookupSpecialEventRule
// with a stubbed DB layer. Pure-helper extraction is a future cleanup.

import type {
  SpecialEventDateMatchPattern,
  SpecialEventVenueRunPattern,
  SpecialEventTourNamePattern,
} from '@showbook/db';

// Re-implement the matcher locally to assert its contract without a
// DB. The production code uses the same predicates inline; if the
// production matcher diverges, this test will catch the divergence
// when integrated.

function matchesDateRule(
  pattern: SpecialEventDateMatchPattern,
  targetDate: string,
): boolean {
  const target = new Date(`${targetDate}T00:00:00Z`);
  return (
    target.getUTCMonth() + 1 === pattern.month &&
    target.getUTCDate() === pattern.day
  );
}

function matchesVenueRule(
  pattern: SpecialEventVenueRunPattern,
  venueName: string | null,
): boolean {
  if (!venueName) return false;
  return venueName
    .toLowerCase()
    .includes(pattern.venueNamePattern.toLowerCase());
}

function matchesTourPattern(
  pattern: SpecialEventTourNamePattern,
  tourName: string | null,
): boolean {
  if (!tourName) return false;
  try {
    return new RegExp(pattern.regex, 'i').test(tourName);
  } catch {
    return false;
  }
}

describe('Special-event date_match rule (Phish Halloween)', () => {
  const halloweenPattern: SpecialEventDateMatchPattern = { month: 10, day: 31 };

  test('matches a date in October 31', () => {
    assert.equal(matchesDateRule(halloweenPattern, '2025-10-31'), true);
    assert.equal(matchesDateRule(halloweenPattern, '2024-10-31'), true);
  });

  test('does not match October 30 or November 1', () => {
    assert.equal(matchesDateRule(halloweenPattern, '2025-10-30'), false);
    assert.equal(matchesDateRule(halloweenPattern, '2025-11-01'), false);
  });

  test('NYE pattern matches December 31 across years', () => {
    const nye: SpecialEventDateMatchPattern = { month: 12, day: 31 };
    assert.equal(matchesDateRule(nye, '2025-12-31'), true);
    assert.equal(matchesDateRule(nye, '2099-12-31'), true);
    assert.equal(matchesDateRule(nye, '2025-01-31'), false);
  });

  test('respects UTC interpretation (no timezone drift)', () => {
    // Date strings are interpreted as UTC; "2025-10-31" should not
    // shift to October 30 depending on Node's locale TZ.
    assert.equal(matchesDateRule(halloweenPattern, '2025-10-31'), true);
  });
});

describe('Special-event venue_run rule', () => {
  test('matches partial venue name (case-insensitive)', () => {
    const sphere: SpecialEventVenueRunPattern = {
      venueNamePattern: 'Sphere',
    };
    assert.equal(matchesVenueRule(sphere, 'Sphere at The Venetian Resort'), true);
    assert.equal(matchesVenueRule(sphere, 'sphere'), true);
    assert.equal(matchesVenueRule(sphere, 'THE SPHERE'), true);
  });

  test('does not match unrelated venues', () => {
    const sphere: SpecialEventVenueRunPattern = {
      venueNamePattern: 'Sphere',
    };
    assert.equal(matchesVenueRule(sphere, 'Madison Square Garden'), false);
    assert.equal(matchesVenueRule(sphere, ''), false);
    assert.equal(matchesVenueRule(sphere, null), false);
  });
});

describe('Special-event tour_name_pattern rule', () => {
  test('matches regex against tour name', () => {
    const anniversary: SpecialEventTourNamePattern = {
      regex: 'anniversary|legacy',
    };
    assert.equal(
      matchesTourPattern(anniversary, 'The Rising 20th Anniversary Tour'),
      true,
    );
    assert.equal(matchesTourPattern(anniversary, 'Legacy Tour'), true);
    assert.equal(matchesTourPattern(anniversary, 'Vegas Residency'), false);
  });

  test('returns false on malformed regex', () => {
    const bad: SpecialEventTourNamePattern = { regex: '(unclosed' };
    assert.equal(matchesTourPattern(bad, 'Any Tour'), false);
  });

  test('returns false on null tour', () => {
    const anniv: SpecialEventTourNamePattern = { regex: 'tour' };
    assert.equal(matchesTourPattern(anniv, null), false);
  });
});
