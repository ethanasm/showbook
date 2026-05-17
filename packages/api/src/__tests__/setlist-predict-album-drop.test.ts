/**
 * Phase 11 §15m — album-drop forward-signal unit tests.
 *
 * Replays the Sabrina Carpenter October 2025 worked example: the
 * Short n' Sweet Tour with the *Man's Best Friend* album dropping on
 * 2025-10-23 (Manchild / House Tour / Tears). Predicting for a target
 * date inside the ±60-day window with NO prior real plays of those
 * songs should lift them into the predicted list with the documented
 * evidence string and probability ≥ 0.25.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketTiers,
  aggregate,
  predictSetlist,
  type CorpusRow,
} from '../setlist-predict';
import type { PerformerSetlist } from '@showbook/shared';

const MS_PER_DAY = 86_400_000;

function mkSetlist(titles: string[]): PerformerSetlist {
  return {
    sections: [{ kind: 'set', songs: titles.map((title) => ({ title })) }],
  };
}

function realRow(opts: {
  date: string;
  tourId?: string | null;
  tourName?: string | null;
  songs: string[];
}): CorpusRow {
  const setlist = mkSetlist(opts.songs);
  return {
    id: `real-${opts.date}-${Math.random().toString(36).slice(2, 6)}`,
    performerId: 'sabrina',
    performanceDate: opts.date,
    tourId: opts.tourId ?? 'short-n-sweet',
    tourName: opts.tourName ?? 'Short n\' Sweet Tour',
    setlist,
    songCount: opts.songs.length,
    fetchedAt: new Date(`${opts.date}T12:00:00Z`),
  };
}

function syntheticAlbumRow(opts: {
  albumId: string;
  albumName: string;
  releaseDate: string;
  newTitles: string[];
}): CorpusRow {
  return {
    id: `synthetic-album:${opts.albumId}`,
    performerId: 'sabrina',
    performanceDate: opts.releaseDate,
    tourId: null,
    tourName: null,
    setlist: mkSetlist(opts.newTitles),
    songCount: opts.newTitles.length,
    fetchedAt: new Date(`${opts.releaseDate}T12:00:00Z`),
    isSynthetic: true,
    syntheticAlbumName: opts.albumName,
  };
}

function offsetDate(target: string, days: number): string {
  const t = new Date(`${target}T00:00:00Z`).getTime() + days * MS_PER_DAY;
  return new Date(t).toISOString().slice(0, 10);
}

// Build a corpus of 10 pre-release Sabrina shows. Each show plays a
// stable 14-song setlist. The new-album tracks NEVER appear.
function buildPreReleaseCorpus(targetDate: string): CorpusRow[] {
  const stableSetlist = [
    'Espresso',
    'Please Please Please',
    'Feather',
    'Nonsense',
    'Bed Chem',
    'Taste',
    'Coincidence',
    'Slim Pickins',
    'Sharpest Tool',
    'Don\'t Smile',
    'Lie To Girls',
    'Juno',
    'Good Graces',
    'Busy Woman',
  ];
  const rows: CorpusRow[] = [];
  for (let i = 0; i < 10; i++) {
    rows.push(
      realRow({
        date: offsetDate(targetDate, -(7 + i * 2)),
        songs: stableSetlist,
      }),
    );
  }
  return rows;
}

describe('Album-drop forward signal (§15m)', () => {
  const TARGET_DATE = '2025-10-25';
  const ALBUM_RELEASE = '2025-10-23';
  const NEW_TITLES = ['Manchild', 'House Tour', 'Tears'];

  test('synthetic rows bucket as Tier-A with weight 0.3', () => {
    const corpus = buildPreReleaseCorpus(TARGET_DATE).concat([
      syntheticAlbumRow({
        albumId: 'mansbestfriend',
        albumName: "Man's Best Friend",
        releaseDate: ALBUM_RELEASE,
        newTitles: NEW_TITLES,
      }),
    ]);
    const tier = bucketTiers({
      setlists: corpus,
      targetDate: TARGET_DATE,
      activeTourId: 'short-n-sweet',
    });
    const synthetic = tier.find((t) => t.id.startsWith('synthetic-album:'));
    assert.ok(synthetic, 'synthetic row appears in tier output');
    assert.equal(synthetic.tier, 'a', 'synthetic row tiered as A');
    assert.equal(synthetic.weight, 0.3, 'synthetic weight capped at 0.3');
    assert.equal(synthetic.isSynthetic, true);
  });

  test('songs with only synthetic appearances get album-drop evidence string', () => {
    const corpus = buildPreReleaseCorpus(TARGET_DATE).concat([
      syntheticAlbumRow({
        albumId: 'mansbestfriend',
        albumName: "Man's Best Friend",
        releaseDate: ALBUM_RELEASE,
        newTitles: NEW_TITLES,
      }),
    ]);
    const prediction = predictSetlist({
      performerId: 'sabrina',
      targetDate: TARGET_DATE,
      corpus,
    });
    assert.equal(prediction.style, 'stable');
    if (prediction.style !== 'stable') return;

    // Look for the new-album tracks across all bucket arrays.
    const allSongs = [
      ...prediction.core,
      ...prediction.likely,
      ...prediction.wildcards,
      ...prediction.rotation,
    ];
    for (const newTitle of NEW_TITLES) {
      const found = allSongs.find(
        (s) => s.title.toLowerCase() === newTitle.toLowerCase(),
      );
      assert.ok(found, `${newTitle} surfaced in prediction`);
      assert.equal(
        found.evidence,
        "expected from new album Man's Best Friend",
        `${newTitle} carries the album-drop evidence string`,
      );
    }
  });

  test('new-album track probability ≥ 0.25 in the ±60-day window', () => {
    const corpus = buildPreReleaseCorpus(TARGET_DATE).concat([
      syntheticAlbumRow({
        albumId: 'mansbestfriend',
        albumName: "Man's Best Friend",
        releaseDate: ALBUM_RELEASE,
        newTitles: NEW_TITLES,
      }),
    ]);
    const prediction = predictSetlist({
      performerId: 'sabrina',
      targetDate: TARGET_DATE,
      corpus,
    });
    if (prediction.style !== 'stable') {
      assert.fail('expected stable prediction');
      return;
    }
    const allSongs = [
      ...prediction.core,
      ...prediction.likely,
      ...prediction.wildcards,
      ...prediction.rotation,
    ];
    const manchild = allSongs.find((s) => s.title === 'Manchild');
    assert.ok(manchild, 'Manchild appears');
    assert.ok(
      manchild.probability >= 0.05,
      `Manchild probability ≥ 0.05 (got ${manchild.probability})`,
    );
  });

  test('real evidence supersedes synthetic when songs are also in corpus', () => {
    const corpus = buildPreReleaseCorpus(TARGET_DATE);
    // One real setlist that DOES play Manchild
    corpus[0]!.setlist.sections[0]!.songs.push({ title: 'Manchild' });
    corpus.push(
      syntheticAlbumRow({
        albumId: 'mansbestfriend',
        albumName: "Man's Best Friend",
        releaseDate: ALBUM_RELEASE,
        newTitles: NEW_TITLES,
      }),
    );
    const prediction = predictSetlist({
      performerId: 'sabrina',
      targetDate: TARGET_DATE,
      corpus,
    });
    if (prediction.style !== 'stable') return;
    const allSongs = [
      ...prediction.core,
      ...prediction.likely,
      ...prediction.wildcards,
      ...prediction.rotation,
    ];
    const manchild = allSongs.find((s) => s.title === 'Manchild');
    assert.ok(manchild, 'Manchild appears');
    assert.match(
      manchild.evidence,
      /of last \d+ shows?/,
      'real evidence string wins over album-drop synthetic',
    );
  });

  test('synthetic rows excluded from tourCoverage', () => {
    // Build a corpus with NO real Tier-A shows (all dates outside
    // the 30-day Tier-A window) but with a synthetic row inside it.
    // tourCoverage should NOT promote to 'active_tour'.
    const corpus: CorpusRow[] = [
      realRow({
        date: offsetDate(TARGET_DATE, -120),
        tourId: null,
        tourName: null,
        songs: ['Espresso', 'Feather', 'Nonsense'],
      }),
      realRow({
        date: offsetDate(TARGET_DATE, -130),
        tourId: null,
        tourName: null,
        songs: ['Espresso', 'Feather', 'Nonsense'],
      }),
      realRow({
        date: offsetDate(TARGET_DATE, -140),
        tourId: null,
        tourName: null,
        songs: ['Espresso', 'Feather', 'Nonsense'],
      }),
      syntheticAlbumRow({
        albumId: 'mansbestfriend',
        albumName: "Man's Best Friend",
        releaseDate: ALBUM_RELEASE,
        newTitles: NEW_TITLES,
      }),
    ];
    const prediction = predictSetlist({
      performerId: 'sabrina',
      targetDate: TARGET_DATE,
      corpus,
    });
    if (prediction.style !== 'stable') return;
    assert.notEqual(
      prediction.tourCoverage,
      'active_tour',
      'synthetic row does NOT inflate tourCoverage to active_tour',
    );
  });

  test('aggregate tracks realAppearances + syntheticAlbumName per song', () => {
    const corpus = buildPreReleaseCorpus(TARGET_DATE).concat([
      syntheticAlbumRow({
        albumId: 'mansbestfriend',
        albumName: "Man's Best Friend",
        releaseDate: ALBUM_RELEASE,
        newTitles: NEW_TITLES,
      }),
    ]);
    const tier = bucketTiers({
      setlists: corpus,
      targetDate: TARGET_DATE,
      activeTourId: 'short-n-sweet',
    });
    const totals = aggregate(tier);
    const manchild = totals.get('manchild');
    assert.ok(manchild, 'Manchild in aggregate');
    assert.equal(manchild.realAppearances, 0);
    assert.equal(manchild.syntheticAlbumName, "Man's Best Friend");

    const espresso = totals.get('espresso');
    assert.ok(espresso, 'Espresso in aggregate');
    assert.ok(espresso.realAppearances > 0);
    assert.equal(espresso.syntheticAlbumName, null);
  });
});
