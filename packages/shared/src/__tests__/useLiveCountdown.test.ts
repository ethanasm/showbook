/**
 * Pure-formatter tests for the live-countdown hook. The hook itself
 * (scheduling, cleanup) is exercised under jsdom in
 * `apps/web/lib/__tests__/useLiveCountdown.test.tsx`; this file
 * covers the cadence-transition branches without needing a renderer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown } from '../hooks/useLiveCountdown';

const DOORS_HOUR = 19;
// Local-zone anchor — mirrors the hook's `resolveTargetMs`.
const target = (ymd: string): number => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, DOORS_HOUR, 0, 0, 0).getTime();
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('formatCountdown', () => {
  it('returns "date TBD" for unparseable input', () => {
    assert.equal(formatCountdown('not-a-date', DOORS_HOUR, 0), 'date TBD');
  });

  it('returns "started" once the doors anchor has passed', () => {
    const t = target('2026-05-21');
    assert.equal(formatCountdown('2026-05-21', DOORS_HOUR, t + 1000), 'started');
    assert.equal(formatCountdown('2026-05-21', DOORS_HOUR, t), 'started');
  });

  it('returns calendar copy beyond 48 h ("tomorrow" / "in N days")', () => {
    const t = target('2026-06-01');
    // ~5 days out → "in 5 days"
    assert.equal(formatCountdown('2026-06-01', DOORS_HOUR, t - 5 * DAY), 'in 5 days');
    // ~1 day out is still "tomorrow" once we round to >= 2 days from the boundary
    assert.equal(formatCountdown('2026-06-01', DOORS_HOUR, t - 3 * DAY), 'in 3 days');
  });

  it('returns h-min between 1 h and 48 h', () => {
    const t = target('2026-06-01');
    // 23 h 4 m
    const ms = 23 * HOUR + 4 * 60_000;
    assert.equal(
      formatCountdown('2026-06-01', DOORS_HOUR, t - ms),
      '23h 04m',
    );
    // exactly 1 h
    assert.equal(
      formatCountdown('2026-06-01', DOORS_HOUR, t - HOUR),
      '1h 00m',
    );
  });

  it('returns hh:mm:ss under the last hour', () => {
    const t = target('2026-06-01');
    // 14 minutes 9 seconds out
    const ms = 14 * 60_000 + 9 * 1000;
    assert.equal(
      formatCountdown('2026-06-01', DOORS_HOUR, t - ms),
      '00:14:09',
    );
    // 1 second out
    assert.equal(
      formatCountdown('2026-06-01', DOORS_HOUR, t - 1000),
      '00:00:01',
    );
  });
});
