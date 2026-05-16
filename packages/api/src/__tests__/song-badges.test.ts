/**
 * Unit suite for `computeSongBadges` — the pure resolver that decides
 * which Setlist-tab rows get a 🆕 or 🎯 inline badge. Asserts the
 * three boundary cases the show-detail UI cares about:
 *   - `firstTime` lights up only on the show whose date matches the
 *     user's earliest attended appearance of that song;
 *   - `rareCatch` requires a corpus total ≥ `RARE_MIN_CORPUS_TOTAL`
 *     before it computes anything (avoids "1 of 2 setlists = 50%
 *     rare" nonsense);
 *   - the output map is sparse — songs with no badge are omitted so
 *     the UI can render plain rows without iterating empty objects.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSongBadges, RARE_THRESHOLD } from '../song-badges';

const SHOW_DATE = '2025-09-15';

describe('computeSongBadges', () => {
  test('returns empty when no songs are passed', () => {
    const out = computeSongBadges({
      songIds: [],
      showDate: SHOW_DATE,
      firstAppearances: [],
      corpusFrequencies: [],
      corpusTotalForPerformer: 25,
    });
    assert.deepEqual(out, {});
  });

  test('flags `firstTime` for a song whose earliest attended date is this show', () => {
    const out = computeSongBadges({
      songIds: ['s1'],
      showDate: SHOW_DATE,
      firstAppearances: [{ songId: 's1', firstDate: SHOW_DATE }],
      corpusFrequencies: [],
      corpusTotalForPerformer: 0,
    });
    assert.equal(out['s1']?.firstTime, true);
    assert.equal(out['s1']?.rareCatch, null);
  });

  test('does NOT flag `firstTime` when the earliest attended date is older', () => {
    const out = computeSongBadges({
      songIds: ['s1'],
      showDate: SHOW_DATE,
      firstAppearances: [{ songId: 's1', firstDate: '2024-03-01' }],
      corpusFrequencies: [],
      corpusTotalForPerformer: 0,
    });
    // Song heard before — no first-time badge, and no rare badge
    // (corpus is empty), so the row is omitted entirely.
    assert.equal(out['s1'], undefined);
  });

  test('does NOT flag `firstTime` when showDate is null', () => {
    const out = computeSongBadges({
      songIds: ['s1'],
      showDate: null,
      firstAppearances: [{ songId: 's1', firstDate: '2025-09-15' }],
      corpusFrequencies: [],
      corpusTotalForPerformer: 0,
    });
    assert.equal(out['s1'], undefined);
  });

  test('flags `rareCatch` when corpus frequency is below the 5% threshold', () => {
    // 1 of 25 corpus setlists = 4% — under 5%.
    const out = computeSongBadges({
      songIds: ['s-rare', 's-common'],
      showDate: SHOW_DATE,
      firstAppearances: [],
      corpusFrequencies: [
        { songId: 's-rare', corpusHits: 1 },
        { songId: 's-common', corpusHits: 20 },
      ],
      corpusTotalForPerformer: 25,
    });
    assert.ok(out['s-rare']?.rareCatch);
    assert.equal(out['s-rare']?.rareCatch?.fractionPct, 4);
    assert.equal(out['s-rare']?.firstTime, false);
    assert.equal(out['s-common'], undefined);
  });

  test('does NOT flag `rareCatch` when corpus total is below the noise floor', () => {
    // 1 of 5 = 20%, but corpus total < RARE_MIN_CORPUS_TOTAL — skip.
    const out = computeSongBadges({
      songIds: ['s1'],
      showDate: SHOW_DATE,
      firstAppearances: [],
      corpusFrequencies: [{ songId: 's1', corpusHits: 1 }],
      corpusTotalForPerformer: 5,
    });
    assert.equal(out['s1'], undefined);
  });

  test('floors fractionPct at 1 so a 0-hit-but-below-threshold catch never renders as 0%', () => {
    // Pathological — shouldn't happen given the `hits` query but the
    // floor matters: if rounding produces 0 we still show ≥ 1%.
    const out = computeSongBadges({
      songIds: ['s1'],
      showDate: SHOW_DATE,
      firstAppearances: [],
      corpusFrequencies: [], // implicit 0 hits
      corpusTotalForPerformer: 200, // total above floor → eligible
    });
    // 0 / 200 = 0% < threshold → rareCatch fires
    assert.ok(out['s1']?.rareCatch);
    assert.equal(out['s1']?.rareCatch?.fractionPct, 1);
  });

  test('can flag both `firstTime` and `rareCatch` on the same song', () => {
    const out = computeSongBadges({
      songIds: ['s1'],
      showDate: SHOW_DATE,
      firstAppearances: [{ songId: 's1', firstDate: SHOW_DATE }],
      corpusFrequencies: [{ songId: 's1', corpusHits: 1 }],
      corpusTotalForPerformer: 50,
    });
    assert.equal(out['s1']?.firstTime, true);
    assert.equal(out['s1']?.rareCatch?.fractionPct, 2);
  });

  test('RARE_THRESHOLD boundary: 5% exactly → not rare (strict `<`)', () => {
    // 5 of 100 = exactly 5% — boundary excluded.
    const out = computeSongBadges({
      songIds: ['s1'],
      showDate: SHOW_DATE,
      firstAppearances: [],
      corpusFrequencies: [{ songId: 's1', corpusHits: 5 }],
      corpusTotalForPerformer: 100,
    });
    assert.equal(out['s1'], undefined);
    // Sanity — the threshold is what we documented.
    assert.equal(RARE_THRESHOLD, 0.05);
  });
});
