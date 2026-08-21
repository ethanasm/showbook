import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateParts, toDateParts } from '../date-parts';

describe('date-parts', () => {
  test('title-cases the month the shared helper upper-cases', () => {
    const parts = formatDateParts('2026-09-11');
    assert.equal(parts.month, 'Sep');
    assert.equal(parts.day, '11');
    assert.equal(parts.year, '2026');
    assert.equal(parts.dow, 'Fri');
  });

  test('re-cases every month, not just the ones with a lowercase tail', () => {
    // "MAY" is the one abbreviation that is also a whole word, and "JUL" /
    // "JUN" differ only in their last letter — cheap places to get a
    // slice-based re-caser wrong.
    for (const [date, month] of [
      ['2026-01-05', 'Jan'],
      ['2026-05-05', 'May'],
      ['2026-06-05', 'Jun'],
      ['2026-07-05', 'Jul'],
      ['2026-12-05', 'Dec'],
    ] as const) {
      assert.equal(formatDateParts(date).month, month, date);
    }
  });

  test('leaves the default fallback untouched', () => {
    // The guard exists so "TBD" doesn't come back as "Tbd" — it is a
    // three-letter uppercase string exactly like a month abbreviation.
    assert.deepEqual(formatDateParts(null), {
      month: 'TBD',
      day: '',
      year: '—',
      dow: 'date',
    });
  });

  test('leaves a caller-supplied fallback untouched', () => {
    const fallback = { month: '—', day: '—', year: '', dow: '' };
    assert.deepEqual(formatDateParts(undefined, fallback), fallback);
    assert.deepEqual(formatDateParts('not-a-date', fallback), fallback);
  });

  test('passes a caller-supplied fallback through on a valid date', () => {
    const fallback = { month: '—', day: '—', year: '', dow: '' };
    assert.equal(formatDateParts('2026-08-16', fallback).month, 'Aug');
  });

  test('toDateParts is the same function under the name the list code uses', () => {
    assert.equal(toDateParts, formatDateParts);
  });
});
