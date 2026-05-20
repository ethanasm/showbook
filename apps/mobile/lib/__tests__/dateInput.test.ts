/**
 * Unit tests for `lib/dateInput` — the dash-and-format normalizer
 * for the add/edit show date field.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isYmd,
  normalizeDashes,
  normalizeDateInput,
  parseToIso,
} from '../dateInput';

describe('normalizeDashes', () => {
  it('leaves an ASCII hyphen untouched', () => {
    assert.equal(normalizeDashes('2018-08-05'), '2018-08-05');
  });

  it('replaces en-dash with hyphen — the iOS smart-punctuation case', () => {
    // U+2013 between month and day
    assert.equal(normalizeDashes('2018-08–05'), '2018-08-05');
    assert.equal(normalizeDashes('2018–08–05'), '2018-08-05');
  });

  it('replaces em-dash, figure dash, minus sign, fullwidth hyphen', () => {
    assert.equal(normalizeDashes('2018—08—05'), '2018-08-05');
    assert.equal(normalizeDashes('2018‒08‒05'), '2018-08-05');
    assert.equal(normalizeDashes('2018−08−05'), '2018-08-05');
    assert.equal(normalizeDashes('2018－08－05'), '2018-08-05');
  });

  it('leaves non-dash text unchanged', () => {
    assert.equal(normalizeDashes('August 5, 2018'), 'August 5, 2018');
    assert.equal(normalizeDashes(''), '');
  });
});

describe('parseToIso', () => {
  it('passes through valid ISO dates', () => {
    assert.equal(parseToIso('2018-08-05'), '2018-08-05');
    assert.equal(parseToIso('2026-12-31'), '2026-12-31');
  });

  it('normalizes ISO dates with en-dashes', () => {
    assert.equal(parseToIso('2018-08–05'), '2018-08-05');
  });

  it('zero-pads single-digit month / day in ISO-shaped input', () => {
    assert.equal(parseToIso('2018-8-5'), '2018-08-05');
  });

  it('rejects calendar-invalid ISO dates', () => {
    assert.equal(parseToIso('2018-13-05'), null);
    assert.equal(parseToIso('2018-02-30'), null);
    assert.equal(parseToIso('2021-02-29'), null); // not a leap year
  });

  it('accepts leap-year Feb 29', () => {
    assert.equal(parseToIso('2024-02-29'), '2024-02-29');
    assert.equal(parseToIso('2000-02-29'), '2000-02-29');
  });

  it('parses US slash format (m/d/y)', () => {
    assert.equal(parseToIso('8/5/2018'), '2018-08-05');
    assert.equal(parseToIso('08/05/2018'), '2018-08-05');
    assert.equal(parseToIso('12/31/2026'), '2026-12-31');
  });

  it('parses US slash format with 2-digit year', () => {
    assert.equal(parseToIso('8/5/24'), '2024-08-05');
    assert.equal(parseToIso('8/5/99'), '1999-08-05');
    assert.equal(parseToIso('8/5/00'), '2000-08-05');
  });

  it('parses US dash format (m-d-y)', () => {
    assert.equal(parseToIso('8-5-2018'), '2018-08-05');
  });

  it('parses "August 5, 2018" and variants', () => {
    assert.equal(parseToIso('August 5, 2018'), '2018-08-05');
    assert.equal(parseToIso('August 5 2018'), '2018-08-05');
    assert.equal(parseToIso('Aug 5, 2018'), '2018-08-05');
    assert.equal(parseToIso('Aug. 5, 2018'), '2018-08-05');
    assert.equal(parseToIso('Sept 5, 2018'), '2018-09-05');
    assert.equal(parseToIso('December 31, 2026'), '2026-12-31');
  });

  it('parses ordinal suffixes (5th, 1st, 2nd, 3rd)', () => {
    assert.equal(parseToIso('August 5th, 2018'), '2018-08-05');
    assert.equal(parseToIso('Jan 1st 2024'), '2024-01-01');
    assert.equal(parseToIso('Feb 2nd, 2024'), '2024-02-02');
    assert.equal(parseToIso('Mar 3rd, 2024'), '2024-03-03');
  });

  it('assumes current year when none given', () => {
    const now = new Date('2026-05-20T00:00:00');
    assert.equal(parseToIso('August 5', { now }), '2026-08-05');
    assert.equal(parseToIso('Aug 5', { now }), '2026-08-05');
  });

  it('is case insensitive on month names', () => {
    assert.equal(parseToIso('AUGUST 5, 2018'), '2018-08-05');
    assert.equal(parseToIso('august 5, 2018'), '2018-08-05');
  });

  it('returns null for garbage', () => {
    assert.equal(parseToIso(''), null);
    assert.equal(parseToIso('   '), null);
    assert.equal(parseToIso('next week'), null);
    assert.equal(parseToIso('2018'), null);
    assert.equal(parseToIso('Friday'), null);
  });
});

describe('normalizeDateInput', () => {
  it('canonicalizes parseable input to YYYY-MM-DD', () => {
    assert.equal(normalizeDateInput('August 5, 2018'), '2018-08-05');
    assert.equal(normalizeDateInput('8/5/2018'), '2018-08-05');
  });

  it('canonicalizes en-dashed YYYY-MM-DD input', () => {
    // The exact case from the bug report
    assert.equal(normalizeDateInput('2018-08–05'), '2018-08-05');
  });

  it('returns dash-normalized partial input unchanged when not parseable', () => {
    // User is still typing — don't auto-collapse to something they
    // didn't ask for, but do swap stealth en-dashes for ASCII so
    // when they finish typing the validator sees what they see.
    assert.equal(normalizeDateInput('2018-08–'), '2018-08-');
    assert.equal(normalizeDateInput('2018-'), '2018-');
    assert.equal(normalizeDateInput(''), '');
  });

  it('returns empty string for non-string input', () => {
    assert.equal(normalizeDateInput(undefined as unknown as string), '');
    assert.equal(normalizeDateInput(null as unknown as string), '');
  });
});

describe('isYmd', () => {
  it('matches the exact YYYY-MM-DD shape', () => {
    assert.equal(isYmd('2018-08-05'), true);
    assert.equal(isYmd('2026-12-31'), true);
  });

  it('rejects non-ASCII dashes (so callers must normalize first)', () => {
    assert.equal(isYmd('2018-08–05'), false);
  });

  it('rejects partial or wrong-shape input', () => {
    assert.equal(isYmd(''), false);
    assert.equal(isYmd('2018-8-5'), false);
    assert.equal(isYmd('August 5, 2018'), false);
    assert.equal(isYmd('20180805'), false);
  });

  it('trims surrounding whitespace before matching', () => {
    assert.equal(isYmd('  2018-08-05  '), true);
  });
});
