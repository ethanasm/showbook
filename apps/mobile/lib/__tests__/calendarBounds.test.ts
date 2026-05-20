/**
 * Unit tests for `lib/calendarBounds` — month-navigation bounds for the
 * Shows tab Upcoming / Past buckets.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  atMaxCursor,
  atMinCursor,
  computeMonthBounds,
  stepCursor,
} from '../calendarBounds';

const TODAY = { year: 2026, month: 4 }; // May 2026

describe('computeMonthBounds (upcoming)', () => {
  it('clamps the minimum to the current month, regardless of data', () => {
    const bounds = computeMonthBounds({
      showDates: ['2027-01-15', '2028-06-01'],
      stateBucket: 'upcoming',
      today: TODAY,
    });
    assert.deepEqual(bounds.min, TODAY);
    assert.deepEqual(bounds.max, { year: 2028, month: 11 });
  });

  it('uses December of the current year as the max when there are no future-year shows', () => {
    const bounds = computeMonthBounds({
      showDates: [],
      stateBucket: 'upcoming',
      today: TODAY,
    });
    assert.deepEqual(bounds.min, TODAY);
    assert.deepEqual(bounds.max, { year: 2026, month: 11 });
  });

  it('ignores null show dates (date-TBD watching rows)', () => {
    const bounds = computeMonthBounds({
      showDates: [null, '2027-03-01'],
      stateBucket: 'upcoming',
      today: TODAY,
    });
    assert.deepEqual(bounds.max, { year: 2027, month: 11 });
  });
});

describe('computeMonthBounds (past)', () => {
  it('clamps the maximum to the current month, regardless of data', () => {
    const bounds = computeMonthBounds({
      showDates: ['2023-01-15', '2024-06-01'],
      stateBucket: 'past',
      today: TODAY,
    });
    assert.deepEqual(bounds.min, { year: 2023, month: 0 });
    assert.deepEqual(bounds.max, TODAY);
  });

  it('uses January of the current year as the min when there are no past-year shows', () => {
    const bounds = computeMonthBounds({
      showDates: [],
      stateBucket: 'past',
      today: TODAY,
    });
    assert.deepEqual(bounds.min, { year: 2026, month: 0 });
    assert.deepEqual(bounds.max, TODAY);
  });
});

describe('atMinCursor / atMaxCursor', () => {
  const upcomingBounds = computeMonthBounds({
    showDates: ['2027-06-15'],
    stateBucket: 'upcoming',
    today: TODAY,
  });

  it('flags the current month as the min in upcoming mode', () => {
    assert.equal(atMinCursor(TODAY, upcomingBounds), true);
    assert.equal(atMinCursor({ year: 2026, month: 5 }, upcomingBounds), false);
  });

  it('flags December of the last data year as the max in upcoming mode', () => {
    assert.equal(atMaxCursor({ year: 2027, month: 11 }, upcomingBounds), true);
    assert.equal(atMaxCursor({ year: 2027, month: 10 }, upcomingBounds), false);
  });

  const pastBounds = computeMonthBounds({
    showDates: ['2023-06-15'],
    stateBucket: 'past',
    today: TODAY,
  });

  it('flags the current month as the max in past mode', () => {
    assert.equal(atMaxCursor(TODAY, pastBounds), true);
    assert.equal(atMaxCursor({ year: 2026, month: 3 }, pastBounds), false);
  });

  it('flags January of the earliest data year as the min in past mode', () => {
    assert.equal(atMinCursor({ year: 2023, month: 0 }, pastBounds), true);
    assert.equal(atMinCursor({ year: 2023, month: 1 }, pastBounds), false);
  });
});

describe('stepCursor', () => {
  const upcomingBounds = computeMonthBounds({
    showDates: ['2027-06-15'],
    stateBucket: 'upcoming',
    today: TODAY,
  });
  const pastBounds = computeMonthBounds({
    showDates: ['2023-06-15'],
    stateBucket: 'past',
    today: TODAY,
  });

  it('advances forward within bounds', () => {
    assert.deepEqual(stepCursor(TODAY, 1, upcomingBounds), { year: 2026, month: 5 });
  });

  it('refuses to step before the upcoming min', () => {
    assert.deepEqual(stepCursor(TODAY, -1, upcomingBounds), TODAY);
  });

  it('refuses to step after the past max', () => {
    assert.deepEqual(stepCursor(TODAY, 1, pastBounds), TODAY);
  });

  it('rolls year boundaries when staying within bounds', () => {
    assert.deepEqual(
      stepCursor({ year: 2026, month: 11 }, 1, upcomingBounds),
      { year: 2027, month: 0 },
    );
    assert.deepEqual(
      stepCursor({ year: 2024, month: 0 }, -1, pastBounds),
      { year: 2023, month: 11 },
    );
  });

  it('refuses to step beyond the December-of-max year in upcoming mode', () => {
    const at = { year: 2027, month: 11 };
    assert.deepEqual(stepCursor(at, 1, upcomingBounds), at);
  });

  it('refuses to step before January-of-min year in past mode', () => {
    const at = { year: 2023, month: 0 };
    assert.deepEqual(stepCursor(at, -1, pastBounds), at);
  });
});
