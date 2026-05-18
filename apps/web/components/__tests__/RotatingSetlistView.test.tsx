/**
 * Component-level test for the Phase 5 rotating-style display variant.
 * Mirrors the Phish worked example from
 * `docs/specs/setlist-intelligence/worked-examples.md` §2 — gap
 * chart rows + position pools + multi-night banner all render against
 * a synthetic prediction payload.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { RotatingPrediction } from '@showbook/api';
import { RotatingSetlistView } from '../show-tabs/RotatingSetlistView';

const PHISH_PREDICTION: RotatingPrediction = {
  style: 'rotating',
  copy:
    'Phish has played 140+ unique songs across 8 Sphere nights so far. ' +
    "Probability of any specific song is low — here's what's overdue.",
  confidence: 0.41,
  sampleSize: 84,
  tourId: 'phish__spring-2026-sphere',
  tourName: 'Spring Tour 2026 — Sphere Residency',
  due: [
    { title: 'Bug', currentGap: 47, meanGap: 12, overdueScore: 3.92, totalPlays: 89, lastPlayedDate: '2025-08-13' },
    { title: 'Tweezer Reprise', currentGap: 18, meanGap: 6, overdueScore: 3.0, totalPlays: 460, lastPlayedDate: '2026-04-12' },
    { title: 'Run Like an Antelope', currentGap: 24, meanGap: 9, overdueScore: 2.66, totalPlays: 380, lastPlayedDate: '2026-04-05' },
  ],
  hot: [
    { title: 'Evolve', playedCount: 6, playedShare: 0.75, evidence: '6 of last 8' },
    { title: 'Sand', playedCount: 4, playedShare: 0.5, evidence: '4 of last 8' },
  ],
  bustoutCandidates: [
    {
      title: 'McGrupp and the Watchful Hosemasters',
      currentGap: 142,
      meanGap: 38,
      overdueScore: 3.74,
      totalPlays: 18,
      lastPlayedDate: '2024-12-30',
    },
  ],
  positions: [
    {
      role: 'opener',
      poolEntropy: 0.78,
      candidates: [
        { title: 'Free', slotShare: 0.13, playedThisRun: true },
        { title: 'Sample in a Jar', slotShare: 0.12 },
        { title: 'AC/DC Bag', slotShare: 0.11 },
      ],
    },
    {
      role: 'encore_close',
      poolEntropy: 0.55,
      candidates: [
        { title: 'Tweezer Reprise', slotShare: 0.21, dueDoubleFlag: true },
        { title: 'First Tube', slotShare: 0.18, playedThisRun: true },
      ],
    },
  ],
  multiNightContext: {
    venue: 'Sphere at the Venetian Resort',
    runIndex: 9,
    priorNights: 8,
    songsAlreadyPlayed: ['Free', 'First Tube', 'Birds of a Feather'],
    runStartDate: '2026-04-16',
  },
  setCountPrediction: null,
};

describe('RotatingSetlistView — Phish worked example', () => {
  it('renders confidence banner with ROTATING archetype label', () => {
    const { getByTestId, queryByText } = render(
      <RotatingSetlistView prediction={PHISH_PREDICTION} />,
    );
    const banner = getByTestId('setlist-confidence-banner-rotating');
    assert.ok(banner);
    assert.ok(banner.textContent?.includes('ROTATING'));
    assert.ok(queryByText(/Spring Tour 2026/));
    cleanup();
  });

  it('renders the multi-night context banner with prior-nights count', () => {
    const { getByTestId } = render(
      <RotatingSetlistView prediction={PHISH_PREDICTION} />,
    );
    const banner = getByTestId('multi-night-context-banner');
    assert.ok(banner.textContent?.includes('Night 9'));
    assert.ok(banner.textContent?.includes('Sphere'));
    cleanup();
  });

  it('expands the played-songs list when "Show all" is clicked', () => {
    const { getByTestId, queryByTestId } = render(
      <RotatingSetlistView prediction={PHISH_PREDICTION} />,
    );
    assert.equal(queryByTestId('multi-night-songs-list'), null);
    fireEvent.click(getByTestId('multi-night-toggle'));
    const list = getByTestId('multi-night-songs-list');
    assert.ok(list.textContent?.includes('Free'));
    assert.ok(list.textContent?.includes('Birds of a Feather'));
    cleanup();
  });

  it('renders gap-chart rows for every due song', () => {
    const { getAllByTestId } = render(
      <RotatingSetlistView prediction={PHISH_PREDICTION} />,
    );
    const rows = getAllByTestId('gap-chart-row');
    assert.equal(rows.length, 3);
    const titles = rows.map((r) => r.getAttribute('data-title'));
    assert.ok(titles.includes('Bug'));
    assert.ok(titles.includes('Tweezer Reprise'));
    cleanup();
  });

  it('renders bustout candidate rows with overdue-score chip', () => {
    const { getAllByTestId } = render(
      <RotatingSetlistView prediction={PHISH_PREDICTION} />,
    );
    const rows = getAllByTestId('bustout-candidate-row');
    assert.equal(rows.length, 1);
    assert.ok(
      rows[0]!.textContent?.includes('McGrupp and the Watchful Hosemasters'),
    );
    cleanup();
  });

  it('renders position pools with played-this-run strike state', () => {
    const { getAllByTestId } = render(
      <RotatingSetlistView prediction={PHISH_PREDICTION} />,
    );
    const candidates = getAllByTestId('position-pool-candidate');
    const free = candidates.find((c) => c.textContent?.includes('Free'));
    assert.ok(free);
    assert.equal(free!.getAttribute('data-played-this-run'), '1');
    cleanup();
  });

  it('shows the ★ DUE double-flag chip on songs that are both due and slot-fit', () => {
    const { getAllByTestId } = render(
      <RotatingSetlistView prediction={PHISH_PREDICTION} />,
    );
    const flags = getAllByTestId('due-double-flag');
    assert.ok(flags.length >= 1, 'expected at least one due/slot-fit chip');
    cleanup();
  });
});
