/**
 * Unit suite for the Phase 5 rotating-style prediction model.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { predictRotating } from '../setlist-predict-rotating';
import type { CorpusRow } from '../setlist-predict';
import type { PerformerSetlist } from '@showbook/shared';

function setlistOf(
  mainSet: string[],
  encore: string[] = [],
): PerformerSetlist {
  const sections: PerformerSetlist['sections'] = [
    { kind: 'set', songs: mainSet.map((t) => ({ title: t })) },
  ];
  if (encore.length > 0) {
    sections.push({ kind: 'encore', songs: encore.map((t) => ({ title: t })) });
  }
  return { sections };
}

function corpus(
  entries: Array<{
    date: string;
    main: string[];
    encore?: string[];
    venue?: string;
  }>,
): CorpusRow[] {
  return entries.map((e, idx) => ({
    id: `row-${idx}`,
    performerId: 'perf-0',
    performanceDate: e.date,
    tourId: 'tour-1',
    tourName: 'Test Tour',
    setlist: setlistOf(e.main, e.encore ?? []),
    songCount: e.main.length + (e.encore?.length ?? 0),
    fetchedAt: new Date(),
    venueNameRaw: e.venue ?? null,
  }));
}

describe('predictRotating', () => {
  test('a long-overdue song surfaces in the due list', () => {
    // 14 nights; "Bug" played on the two oldest nights (back-to-back
    // → meanGap small). Eight intervening nights without "Bug" pushes
    // the current gap well past 1.5× the mean.
    const entries: Array<{ date: string; main: string[]; encore?: string[] }> = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(2026, 3, 30 - i).toISOString().slice(0, 10);
      const main =
        i === 12 || i === 13
          ? ['Bug', 'A', 'B', 'C', 'D']
          : ['A', 'B', 'C', 'D', `Fresh ${i}`];
      entries.push({ date: d, main });
    }
    const out = predictRotating({
      performerId: 'perf-0',
      targetDate: '2026-04-30',
      corpus: corpus(entries),
    });
    const bug = out.due.find((s) => s.title === 'Bug');
    assert.ok(bug, 'Bug should show in due list');
    assert.ok(bug!.currentGap >= 10, 'Bug should have a large current gap');
    assert.ok(bug!.overdueScore >= 1.5);
  });

  test('hot songs are ones played in ≥40% of the last 10 setlists', () => {
    // 10 nights, "Anchor" played in 8 of them.
    const entries: Array<{ date: string; main: string[] }> = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date(2026, 3, 29 - i).toISOString().slice(0, 10);
      const main = i < 8 ? ['Anchor', `Fresh ${i}`] : [`Fresh ${i}`];
      entries.push({ date: d, main });
    }
    const out = predictRotating({
      performerId: 'perf-0',
      targetDate: '2026-04-30',
      corpus: corpus(entries),
    });
    const anchor = out.hot.find((s) => s.title === 'Anchor');
    assert.ok(anchor);
    assert.ok(anchor!.playedShare >= 0.4);
  });

  test('position pools include opener / closer / encore_close roles', () => {
    const entries: Array<{ date: string; main: string[]; encore?: string[] }> =
      [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(2026, 3, 29 - i).toISOString().slice(0, 10);
      entries.push({
        date: d,
        main: ['Opener', `Mid ${i}`, 'Closer'],
        encore: ['Encore A', 'Encore B'],
      });
    }
    const out = predictRotating({
      performerId: 'perf-0',
      targetDate: '2026-04-30',
      corpus: corpus(entries),
    });
    const opener = out.positions.find((p) => p.role === 'opener');
    const closer = out.positions.find((p) => p.role === 'closer');
    const encoreClose = out.positions.find((p) => p.role === 'encore_close');
    assert.ok(opener);
    assert.ok(closer);
    assert.ok(encoreClose);
    // Opener pool should have the recurring opener at top
    assert.equal(opener!.candidates[0]?.title, 'Opener');
    assert.equal(closer!.candidates[0]?.title, 'Closer');
  });

  test('multi-night-run context excludes prior-night songs from pools', () => {
    // 5 nights at the same venue. Prior nights played "Free" as opener;
    // run context should mark it as playedThisRun in the pool.
    const c = corpus([
      { date: '2026-04-29', main: ['Free', 'Song 1'] },
      { date: '2026-04-28', main: ['Free', 'Song 2'] },
      { date: '2026-04-27', main: ['Sample in a Jar', 'Song 3'] },
      { date: '2026-04-26', main: ['Llama', 'Song 4'] },
      { date: '2026-04-25', main: ['AC/DC Bag', 'Song 5'] },
      { date: '2026-04-24', main: ['Wilson', 'Song 6'] },
    ]);
    const out = predictRotating({
      performerId: 'perf-0',
      targetDate: '2026-04-30',
      corpus: c,
      multiNightRun: {
        venue: 'Sphere',
        priorNights: 5,
        runIndex: 6,
        songsAlreadyPlayed: ['Free', 'Sample in a Jar', 'Llama'],
        runStartDate: '2026-04-25',
      },
    });
    const opener = out.positions.find((p) => p.role === 'opener')!;
    const free = opener.candidates.find((c) => c.title === 'Free');
    assert.ok(free);
    assert.equal(free!.playedThisRun, true);
    const wilson = opener.candidates.find((c) => c.title === 'Wilson');
    assert.equal(wilson?.playedThisRun ?? false, false);
    assert.ok(out.multiNightContext);
    assert.equal(out.multiNightContext!.runIndex, 6);
  });

  test('bustout candidates require ≥5 historical plays', () => {
    // "Rare bustout" played once long ago; should NOT make bustout list.
    const entries: Array<{ date: string; main: string[] }> = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(2026, 3, 29 - i).toISOString().slice(0, 10);
      const main =
        i === 11 ? ['Rare bustout', 'Filler 1'] : ['Filler 1', `Filler ${i}`];
      entries.push({ date: d, main });
    }
    const out = predictRotating({
      performerId: 'perf-0',
      targetDate: '2026-04-30',
      corpus: corpus(entries),
    });
    assert.equal(out.bustoutCandidates.find((s) => s.title === 'Rare bustout'), undefined);
  });

  test('confidence is capped at 0.55 (rotating predictions never feel sure)', () => {
    const entries: Array<{ date: string; main: string[] }> = Array.from(
      { length: 30 },
      (_, i) => ({
        date: new Date(2026, 3, 29 - i).toISOString().slice(0, 10),
        main: ['Same', 'Stuff'],
      }),
    );
    const out = predictRotating({
      performerId: 'perf-0',
      targetDate: '2026-04-30',
      corpus: corpus(entries),
    });
    assert.ok(out.confidence <= 0.55);
  });

  test('emits the rotating style discriminator', () => {
    const entries: Array<{ date: string; main: string[] }> = Array.from(
      { length: 5 },
      (_, i) => ({
        date: new Date(2026, 3, 29 - i).toISOString().slice(0, 10),
        main: [`A ${i}`, `B ${i}`],
      }),
    );
    const out = predictRotating({
      performerId: 'perf-0',
      targetDate: '2026-04-30',
      corpus: corpus(entries),
    });
    assert.equal(out.style, 'rotating');
  });
});
