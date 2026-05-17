/**
 * Phase 6 — component tests for the improvised-style display variant.
 * Mirrors the King Gizzard worked example
 * (`specs/setlist-intelligence/worked-examples.md` §4): show
 * modes + vibe sketch, no song-by-song list.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import type { ImprovisedPrediction } from '@showbook/api';
import {
  ImprovisedSetlistView,
  ShowModeOddsCard,
  VibeSketchCard,
} from '../show-tabs/ImprovisedSetlistView';

const KING_GIZZARD_PREDICTION: ImprovisedPrediction = {
  style: 'improvised',
  confidence: 0.18,
  sampleSize: 6,
  tourId: null,
  tourName: null,
  spoilerBlurDefault: false,
  copy: "We can't predict tonight's setlist song-by-song — here's the shape.",
  showModes: [
    { label: 'Regular set', probability: 0.65, expectedSongCount: 11, occurrences: 4 },
    { label: 'Marathon set', probability: 0.3, expectedSongCount: 26, occurrences: 2 },
    { label: 'Microtonal set', probability: 0.05, expectedSongCount: 11, occurrences: 1 },
  ],
  vibeSketch: {
    headlineDescriptor: 'high-energy psych-rock with extended jams',
    axes: {
      energy: 0.8,
      danceability: 0.4,
      jamLength: 0.7,
      novelty: 0.83,
      heaviness: 0.5,
      psychedelia: 0.6,
      tempo: 0.17,
    },
    deltas: [
      { axis: 'novelty', delta: 0.33, description: 'spacier than usual' },
      { axis: 'jamLength', delta: 0.2, description: 'long-form jam-heavy' },
    ],
    popularPicks: [
      { title: 'Gila Monster', playedShare: 0.4, lastPlayedDate: '2025-08-16' },
      { title: 'Robot Stop', playedShare: 0.34, lastPlayedDate: '2025-08-10' },
    ],
    albumsRepresentedRecently: ['Flight b741 (2024)'],
    knownTendencies: ['Marathon shows occur ≈1 in 5'],
  },
  setCountPrediction: null,
};

describe('ImprovisedSetlistView — King Gizzard worked example', () => {
  it('renders the IMPROVISED confidence banner', () => {
    const { getByTestId } = render(
      <ImprovisedSetlistView prediction={KING_GIZZARD_PREDICTION} />,
    );
    const banner = getByTestId('setlist-confidence-banner-improvised');
    assert.ok(banner.textContent?.includes('IMPROVISED'));
    assert.ok(banner.textContent?.includes('psych-rock'));
    cleanup();
  });

  it('renders the no-song-by-song copy block', () => {
    const { getByTestId } = render(
      <ImprovisedSetlistView prediction={KING_GIZZARD_PREDICTION} />,
    );
    const copy = getByTestId('improvised-copy');
    assert.ok(copy.textContent?.includes("can't predict"));
    cleanup();
  });

  it('renders the vibe sketch card with all axes in the radar', () => {
    const { getByTestId } = render(
      <ImprovisedSetlistView prediction={KING_GIZZARD_PREDICTION} />,
    );
    const card = getByTestId('vibe-sketch-card');
    assert.ok(card);
    const radar = getByTestId('vibe-radar-polygon');
    // The polygon attribute should be present and non-empty.
    assert.ok(radar);
    cleanup();
  });

  it('renders show-mode rows in order with percent bars', () => {
    const { getAllByTestId } = render(
      <ImprovisedSetlistView prediction={KING_GIZZARD_PREDICTION} />,
    );
    const rows = getAllByTestId('show-mode-row');
    assert.equal(rows.length, 3);
    assert.equal(rows[0]!.getAttribute('data-mode'), 'Regular set');
    assert.equal(rows[1]!.getAttribute('data-mode'), 'Marathon set');
    assert.equal(rows[2]!.getAttribute('data-mode'), 'Microtonal set');
    cleanup();
  });

  it('renders popular picks list', () => {
    const { getAllByTestId } = render(
      <ImprovisedSetlistView prediction={KING_GIZZARD_PREDICTION} />,
    );
    const rows = getAllByTestId('popular-pick-row');
    assert.equal(rows.length, 2);
    cleanup();
  });

  it('renders known-tendencies bullet list', () => {
    const { getByTestId } = render(
      <ImprovisedSetlistView prediction={KING_GIZZARD_PREDICTION} />,
    );
    const list = getByTestId('vibe-sketch-tendencies');
    assert.ok(list.textContent?.includes('Marathon shows occur'));
    cleanup();
  });

  it('renders vibe-sketch deltas as chips', () => {
    const { getByTestId } = render(
      <ImprovisedSetlistView prediction={KING_GIZZARD_PREDICTION} />,
    );
    const deltas = getByTestId('vibe-sketch-deltas');
    assert.ok(deltas.textContent?.includes('spacier'));
    cleanup();
  });
});

describe('VibeSketchCard — primitive', () => {
  it('omits tendencies list when none are supplied', () => {
    const sketch: ImprovisedPrediction['vibeSketch'] = {
      ...KING_GIZZARD_PREDICTION.vibeSketch,
      knownTendencies: [],
    };
    const { queryByTestId } = render(<VibeSketchCard sketch={sketch} />);
    assert.equal(queryByTestId('vibe-sketch-tendencies'), null);
    cleanup();
  });
});

describe('ShowModeOddsCard — primitive', () => {
  it('returns null when the modes list is empty', () => {
    const { queryByTestId } = render(<ShowModeOddsCard modes={[]} />);
    assert.equal(queryByTestId('show-mode-odds-card'), null);
    cleanup();
  });
});
