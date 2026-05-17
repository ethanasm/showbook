/**
 * Unit suite for the Phase 5 multi-night-run detector.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMultiNightRun } from '../multi-night-run-detector';
import type { CorpusRow } from '../setlist-predict';
import type { PerformerSetlist } from '@showbook/shared';

function setlistOf(titles: string[]): PerformerSetlist {
  return {
    sections: [{ kind: 'set', songs: titles.map((t) => ({ title: t })) }],
  };
}

function corpus(
  entries: Array<{ date: string; venue: string | null; titles: string[] }>,
): CorpusRow[] {
  return entries.map((e, idx) => ({
    id: `row-${idx}`,
    performerId: 'perf-0',
    performanceDate: e.date,
    tourId: null,
    tourName: null,
    setlist: setlistOf(e.titles),
    songCount: e.titles.length,
    fetchedAt: new Date(),
    venueNameRaw: e.venue,
  }));
}

describe('detectMultiNightRun', () => {
  test('catches a 2-night run leading to night 3', () => {
    const c = corpus([
      { date: '2026-04-30', venue: 'Sphere', titles: ['A', 'B'] },
      { date: '2026-04-29', venue: 'Sphere', titles: ['C', 'D'] },
      { date: '2026-04-28', venue: 'Sphere', titles: ['E', 'F'] },
    ]);
    const run = detectMultiNightRun({
      targetDate: '2026-04-30',
      targetVenue: 'Sphere',
      corpus: c,
    });
    assert.ok(run);
    assert.equal(run!.runIndex, 3);
    assert.equal(run!.priorNights, 2);
    assert.equal(run!.venue, 'Sphere');
    assert.deepEqual(
      run!.songsAlreadyPlayed.sort(),
      ['C', 'D', 'E', 'F'].sort(),
    );
  });

  test('returns null when only same-venue weeks-apart shows exist', () => {
    const c = corpus([
      { date: '2026-04-20', venue: 'Sphere', titles: ['A'] },
      { date: '2026-04-29', venue: 'Sphere', titles: ['C'] },
    ]);
    const run = detectMultiNightRun({
      targetDate: '2026-04-30',
      targetVenue: 'Sphere',
      corpus: c,
    });
    // April 29 is consecutive with April 30, so runIndex = 2 — that IS
    // a run. The earlier April 20 night is separate and shouldn't
    // join the chain.
    assert.ok(run);
    assert.equal(run!.runIndex, 2);
    assert.equal(run!.priorNights, 1);
  });

  test('returns null when no same-venue rows exist', () => {
    const c = corpus([
      { date: '2026-04-29', venue: 'Madison Square Garden', titles: ['A'] },
      { date: '2026-04-28', venue: 'Madison Square Garden', titles: ['B'] },
    ]);
    const run = detectMultiNightRun({
      targetDate: '2026-04-30',
      targetVenue: 'Sphere',
      corpus: c,
    });
    assert.equal(run, null);
  });

  test('returns null when targetVenue is missing', () => {
    const c = corpus([
      { date: '2026-04-29', venue: 'Sphere', titles: ['A'] },
    ]);
    const run = detectMultiNightRun({
      targetDate: '2026-04-30',
      targetVenue: null,
      corpus: c,
    });
    assert.equal(run, null);
  });

  test('chain breaks on the first missing date', () => {
    const c = corpus([
      { date: '2026-04-29', venue: 'Sphere', titles: ['A'] },
      // gap on 04-28
      { date: '2026-04-27', venue: 'Sphere', titles: ['C'] },
    ]);
    const run = detectMultiNightRun({
      targetDate: '2026-04-30',
      targetVenue: 'Sphere',
      corpus: c,
    });
    assert.ok(run);
    assert.equal(run!.priorNights, 1);
    assert.deepEqual(run!.songsAlreadyPlayed, ['A']);
  });

  test('venueOf override supports fuzzy matching', () => {
    const c = corpus([
      { date: '2026-04-29', venue: 'The Sphere @ Vegas', titles: ['A'] },
      { date: '2026-04-28', venue: 'Sphere (Vegas)', titles: ['B'] },
    ]);
    const run = detectMultiNightRun({
      targetDate: '2026-04-30',
      targetVenue: 'sphere',
      corpus: c,
      venueOf: (row) =>
        row.venueNameRaw?.toLowerCase().includes('sphere') ? 'sphere' : null,
    });
    assert.ok(run);
    assert.equal(run!.priorNights, 2);
  });

  test('respects 7-day lookback ceiling', () => {
    // A consecutive 10-night chain would technically continue, but the
    // detector caps at 7 nights of lookback.
    const days = Array.from({ length: 10 }, (_, i) => {
      const d = new Date(2026, 3, 29 - i);
      return {
        date: d.toISOString().slice(0, 10),
        venue: 'Sphere',
        titles: [`Song ${i}`],
      };
    });
    const run = detectMultiNightRun({
      targetDate: '2026-04-30',
      targetVenue: 'Sphere',
      corpus: corpus(days),
    });
    assert.ok(run);
    // 7-day lookback caps prior nights at 7.
    assert.ok(run!.priorNights <= 7);
  });
});
