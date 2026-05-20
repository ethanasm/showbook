/**
 * Pure-helper tests for `useIngestPolling`. The hook itself is a thin
 * wrapper around `useCachedQuery` (covered by the warmup tests) — the
 * branchy logic lives in `totalPending` + `computeRefetchIntervals`, so
 * we exercise those directly here. The screen-level wiring is exercised
 * by the Maestro flows on Android CI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  INGEST_POLL_INTERVAL_MS,
  computeRefetchIntervals,
  totalPending,
  type IngestStatusSnapshot,
} from '../../discover/ingest-polling-helpers';

const EMPTY: IngestStatusSnapshot = {
  venueIds: [],
  performerIds: [],
  regionIds: [],
};

describe('totalPending', () => {
  it('returns 0 when the snapshot is missing', () => {
    assert.equal(totalPending(undefined), 0);
    assert.equal(totalPending(null), 0);
  });

  it('returns 0 when all lists are empty', () => {
    assert.equal(totalPending(EMPTY), 0);
  });

  it('sums every category', () => {
    assert.equal(
      totalPending({
        venueIds: ['v1', 'v2'],
        performerIds: ['p1'],
        regionIds: ['r1', 'r2', 'r3'],
      }),
      6,
    );
  });
});

describe('computeRefetchIntervals', () => {
  it('returns false for every feed when nothing is pending', () => {
    const r = computeRefetchIntervals(EMPTY);
    assert.equal(r.nearby, false);
    assert.equal(r.venues, false);
    assert.equal(r.artists, false);
  });

  it('returns false for every feed when the snapshot is missing', () => {
    const r = computeRefetchIntervals(undefined);
    assert.equal(r.nearby, false);
    assert.equal(r.venues, false);
    assert.equal(r.artists, false);
  });

  it('polls the nearby feed when a region ingest is pending', () => {
    const r = computeRefetchIntervals({ ...EMPTY, regionIds: ['r1'] });
    assert.equal(r.nearby, INGEST_POLL_INTERVAL_MS);
    assert.equal(r.venues, false);
    assert.equal(r.artists, false);
  });

  it('polls the nearby feed AND the venues feed when a venue ingest is pending', () => {
    // A followed venue can live inside one of the user's regions, so the
    // nearby feed needs to refresh too — not just the followed-venues feed.
    const r = computeRefetchIntervals({ ...EMPTY, venueIds: ['v1'] });
    assert.equal(r.nearby, INGEST_POLL_INTERVAL_MS);
    assert.equal(r.venues, INGEST_POLL_INTERVAL_MS);
    assert.equal(r.artists, false);
  });

  it('polls only the artists feed when a performer ingest is pending', () => {
    const r = computeRefetchIntervals({ ...EMPTY, performerIds: ['p1'] });
    assert.equal(r.nearby, false);
    assert.equal(r.venues, false);
    assert.equal(r.artists, INGEST_POLL_INTERVAL_MS);
  });

  it('honours a caller-supplied interval', () => {
    const r = computeRefetchIntervals(
      { ...EMPTY, regionIds: ['r1'], performerIds: ['p1'] },
      1234,
    );
    assert.equal(r.nearby, 1234);
    assert.equal(r.artists, 1234);
  });
});
