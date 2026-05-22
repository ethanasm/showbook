import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUpcomingDateHint,
  tmDateWindow,
} from '../../app/(app)/add/chat-tm-match';

describe('isUpcomingDateHint', () => {
  it('returns false for null / undefined / empty', () => {
    assert.equal(isUpcomingDateHint(null), false);
    assert.equal(isUpcomingDateHint(undefined), false);
    assert.equal(isUpcomingDateHint(''), false);
  });

  it('returns false for a non-ISO date string', () => {
    assert.equal(isUpcomingDateHint('August 5'), false);
    assert.equal(isUpcomingDateHint('2026/08/05'), false);
    assert.equal(isUpcomingDateHint('2026-8-5'), false);
  });

  it('returns false for a past date — Ticketmaster does not expose past shows', () => {
    assert.equal(isUpcomingDateHint('2000-01-01'), false);
  });

  it('returns true for a future date', () => {
    assert.equal(isUpcomingDateHint('2099-12-31'), true);
  });

  it("returns true for today's calendar date", () => {
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    assert.equal(isUpcomingDateHint(iso), true);
  });
});

describe('tmDateWindow', () => {
  it('brackets the date by 3 days on each side', () => {
    const { startDate, endDate } = tmDateWindow('2099-06-15');
    assert.equal(startDate, '2099-06-12T00:00:00Z');
    assert.equal(endDate, '2099-06-18T23:59:59Z');
  });

  it('handles month rollover at both bounds', () => {
    assert.deepEqual(tmDateWindow('2099-07-01'), {
      startDate: '2099-06-28T00:00:00Z',
      endDate: '2099-07-04T23:59:59Z',
    });
    assert.deepEqual(tmDateWindow('2099-12-31'), {
      startDate: '2099-12-28T00:00:00Z',
      endDate: '2100-01-03T23:59:59Z',
    });
  });

  it('produces second-precision ISO with no milliseconds (Ticketmaster rejects them)', () => {
    const { startDate, endDate } = tmDateWindow('2099-06-15');
    assert.match(startDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.match(endDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
