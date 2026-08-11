/**
 * Unit tests for the client-side stale-cache guard
 * (`lib/discover/upcoming.ts`) — the mobile twin of the server's
 * `stillUpcoming()` filter. The concrete incident: an expired session
 * 401'd every refetch for weeks while the offline cache kept rendering
 * a July snapshot of Discover as "upcoming".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterUpcomingAnnouncements,
  isStillUpcoming,
  localToday,
} from '../discover/upcoming';

const TODAY = '2026-08-11';

describe('localToday', () => {
  it('formats the device-local calendar date', () => {
    // Construct via local components so the assertion is TZ-stable.
    const d = new Date(2026, 7, 11, 23, 59, 0);
    assert.equal(localToday(d), '2026-08-11');
  });

  it('pads single-digit month and day', () => {
    const d = new Date(2026, 0, 5);
    assert.equal(localToday(d), '2026-01-05');
  });
});

describe('isStillUpcoming', () => {
  it('keeps a single-night show today', () => {
    assert.equal(isStillUpcoming('2026-08-11', null, TODAY), true);
  });

  it('keeps a future single-night show', () => {
    assert.equal(isStillUpcoming('2026-09-01', null, TODAY), true);
  });

  it('drops a past single-night show', () => {
    assert.equal(isStillUpcoming('2026-07-22', null, TODAY), false);
  });

  it('keeps an in-progress multi-night run (past first night, future end)', () => {
    assert.equal(isStillUpcoming('2026-08-01', '2026-08-20', TODAY), true);
  });

  it('keeps a run ending today', () => {
    assert.equal(isStillUpcoming('2026-08-01', '2026-08-11', TODAY), true);
  });

  it('drops a finished run', () => {
    assert.equal(isStillUpcoming('2026-06-01', '2026-07-10', TODAY), false);
  });

  it('treats an undecidable row (no dates) as upcoming', () => {
    assert.equal(isStillUpcoming(null, null, TODAY), true);
    assert.equal(isStillUpcoming(undefined, undefined, TODAY), true);
  });

  it('trims a datetime suffix before comparing', () => {
    assert.equal(isStillUpcoming('2026-07-22T00:00:00.000Z', null, TODAY), false);
    assert.equal(isStillUpcoming('2026-08-11T00:00:00.000Z', null, TODAY), true);
  });

  it('accepts Date instances', () => {
    assert.equal(isStillUpcoming(new Date(2026, 6, 22), null, TODAY), false);
    assert.equal(isStillUpcoming(new Date(2026, 8, 1), null, TODAY), true);
  });
});

describe('filterUpcomingAnnouncements', () => {
  it('drops provably past rows and keeps the rest, preserving order', () => {
    const items = [
      { id: 'past', showDate: '2026-07-22', runEndDate: null },
      { id: 'run', showDate: '2026-08-01', runEndDate: '2026-08-20' },
      { id: 'today', showDate: '2026-08-11', runEndDate: null },
      { id: 'finished-run', showDate: '2026-06-01', runEndDate: '2026-07-01' },
      { id: 'future', showDate: '2026-09-01' },
    ];
    const kept = filterUpcomingAnnouncements(items, TODAY).map((i) => i.id);
    assert.deepEqual(kept, ['run', 'today', 'future']);
  });

  it('returns an empty array untouched', () => {
    assert.deepEqual(filterUpcomingAnnouncements([], TODAY), []);
  });
});
