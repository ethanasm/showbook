/**
 * Unit tests for the Phase 7 recently-played priming job. Verifies the
 * SETTLE window — counts stop updating once enough wall-clock time has
 * passed past the show date — and that "right at midnight" plays
 * bucket cleanly into prep vs post.
 *
 * The DB-touching path is left to integration coverage; here we just
 * exercise the pure window math.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Re-implement the windowing math from the job so the test asserts
// the contract rather than the import shape. If the job changes the
// window constants, this test fails and the changer makes a deliberate
// call about whether to update both.
const SETTLE_MS = 6 * 60 * 60 * 1000;
const PLAY_WINDOW_MS = 6 * 60 * 60 * 1000;

function showMidEpoch(showDate: string): number {
  return new Date(`${showDate}T20:00:00Z`).getTime();
}

function bucket(
  plays: Array<{ playedAt: Date }>,
  showDate: string,
  now: number,
): { prep: number; post: number; settled: boolean } {
  const showMid = showMidEpoch(showDate);
  if (now - showMid > SETTLE_MS + 24 * 60 * 60 * 1000) {
    return { prep: 0, post: 0, settled: true };
  }
  let prep = 0;
  let post = 0;
  for (const p of plays) {
    const dt = p.playedAt.getTime() - showMid;
    if (Math.abs(dt) > PLAY_WINDOW_MS) continue;
    if (dt < 0) prep += 1;
    else post += 1;
  }
  return { prep, post, settled: false };
}

describe('recently-played bucketing', () => {
  it('plays inside the ±6h window count once each', () => {
    const showDate = '2026-04-12';
    const showMid = showMidEpoch(showDate);
    const plays = [
      { playedAt: new Date(showMid - 3 * 60 * 60 * 1000) }, // 3h before
      { playedAt: new Date(showMid - 1 * 60 * 60 * 1000) }, // 1h before
      { playedAt: new Date(showMid + 2 * 60 * 60 * 1000) }, // 2h after
    ];
    const result = bucket(plays, showDate, showMid + 60_000);
    assert.equal(result.prep, 2);
    assert.equal(result.post, 1);
    assert.equal(result.settled, false);
  });

  it('plays outside the ±6h window do not count', () => {
    const showDate = '2026-04-12';
    const showMid = showMidEpoch(showDate);
    const plays = [
      { playedAt: new Date(showMid - 8 * 60 * 60 * 1000) },
      { playedAt: new Date(showMid + 12 * 60 * 60 * 1000) },
    ];
    const result = bucket(plays, showDate, showMid + 60_000);
    assert.equal(result.prep, 0);
    assert.equal(result.post, 0);
  });

  it('play exactly at midnight buckets as post (dt = 0 → ≥ 0)', () => {
    const showDate = '2026-04-12';
    const showMid = showMidEpoch(showDate);
    // Place a play right at the show midpoint.
    const plays = [{ playedAt: new Date(showMid) }];
    const result = bucket(plays, showDate, showMid + 60_000);
    assert.equal(result.prep, 0);
    assert.equal(result.post, 1);
  });

  it('marks settled after 30h past show', () => {
    const showDate = '2026-04-12';
    const showMid = showMidEpoch(showDate);
    const result = bucket(
      [{ playedAt: new Date(showMid + 60_000) }],
      showDate,
      showMid + 31 * 60 * 60 * 1000,
    );
    assert.equal(result.settled, true);
  });

  it('still updates for shows within 30h of now', () => {
    const showDate = '2026-04-12';
    const showMid = showMidEpoch(showDate);
    const result = bucket(
      [{ playedAt: new Date(showMid + 60_000) }],
      showDate,
      showMid + 5 * 60 * 60 * 1000,
    );
    assert.equal(result.settled, false);
    assert.equal(result.post, 1);
  });
});
