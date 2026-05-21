/**
 * Component test (P10 follow-up fix #2): SI-05 hide rule —
 * SetlistTab pre-show must not render the HypePlaylistCard when
 * `prediction.style` is 'rotating' or 'improvised', even if the
 * Spotify feature flag is on. Stable and theatrical both still
 * surface the card.
 *
 * The card's children (HypePlaylistCard, SpoilerCurtain) are stubbed
 * via `mock.module` so we don't have to stand up trpc or localStorage
 * to assert which sub-tree mounts.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import type {
  HotPrediction,
  ImprovisedPrediction,
  RotatingPrediction,
  TheatricalPrediction,
} from '@showbook/api';

// TrackPreview calls trpc on render; stub the trpc client root.
mock.module('@/lib/trpc', {
  namedExports: {
    trpc: {
      setlistIntel: {
        resolveTrackPreview: {
          useMutation: () => ({
            mutateAsync: async () => ({ previewUrl: null, spotifyTrackId: null }),
            isPending: false,
            reset: () => undefined,
          }),
        },
      },
    },
  },
});

// HypePlaylistCard talks to trpc — stub it out to a sentinel marker.
mock.module('../show-tabs/HypePlaylistCard', {
  namedExports: {
    HypePlaylistCard: () => (
      <div data-testid="hype-card-stub">hype</div>
    ),
  },
});

// SpoilerCurtain reads localStorage at render time; stub to render
// nothing so the predicted-setlist body renders directly.
mock.module('../show-tabs/SpoilerCurtain', {
  namedExports: {
    SpoilerCurtain: () => <div data-testid="spoiler-curtain-stub" />,
  },
});

// DiscoveredRail is only rendered for past + musicLayerV2Enabled, but
// it makes a trpc call. Stub it too.
mock.module('../show-tabs/DiscoveredRail', {
  namedExports: {
    DiscoveredRail: () => <div data-testid="discovered-rail-stub" />,
  },
});

let SetlistTabMod: typeof import('../show-tabs/SetlistTab');
let PreviewPlayerMod: typeof import('../../lib/preview-player');
before(async () => {
  SetlistTabMod = await import('../show-tabs/SetlistTab');
  PreviewPlayerMod = await import('../../lib/preview-player');
});

beforeEach(() => cleanup());

const ARTIST = 'Tate McRae';

function stablePrediction(): HotPrediction {
  return {
    style: 'stable',
    confidence: 0.92,
    confidenceNote: null,
    sampleSize: 12,
    tourId: null,
    tourName: 'Test Tour',
    tourCoverage: 'active_tour',
    spoilerBlurDefault: false,
    core: [
      { title: 'Greedy', evidence: '12/12', role: 'opener', songId: null },
      { title: 'Exes', evidence: '10/12', role: 'core', songId: null },
      { title: 'Run For The Hills', evidence: '11/12', role: 'closer', songId: null },
    ],
    likely: [],
    wildcards: [],
    rotation: [],
    setCountPrediction: null,
    multiNightContext: null,
  } as unknown as HotPrediction;
}

function rotatingPrediction(): RotatingPrediction {
  return {
    style: 'rotating',
    copy: 'rotating-style copy',
    confidence: 0.41,
    sampleSize: 80,
    tourId: null,
    tourName: 'Sphere Residency',
    due: [],
    hot: [],
    bustoutCandidates: [],
    positions: [],
    multiNightContext: null,
    setCountPrediction: null,
  } as RotatingPrediction;
}

function theatricalPrediction(): TheatricalPrediction {
  return {
    style: 'theatrical',
    copy: 'theatrical-style copy',
    confidence: 0.78,
    sampleSize: 30,
    tourId: null,
    tourName: 'Eras Tour',
    deterministicSetlist: [
      { title: 'Lavender Haze', act: 'Act I', actIndex: 0, slotShare: 1, probability: 1 },
    ],
    rotatingSlots: [],
    spoilerBlurDefault: false,
    expectedSongCount: 1,
    setCountPrediction: null,
  } as TheatricalPrediction;
}

function improvisedPrediction(): ImprovisedPrediction {
  return {
    style: 'improvised',
    confidence: 0.18,
    sampleSize: 6,
    tourId: null,
    tourName: null,
    spoilerBlurDefault: false,
    copy: "we don't predict song-by-song",
    showModes: [
      { label: 'Regular set', probability: 1, expectedSongCount: 12, occurrences: 1 },
    ],
    vibeSketch: {
      axes: {
        energy: 0.5,
        danceability: 0.5,
        jamLength: 0.5,
        novelty: 0.5,
        heaviness: 0.5,
        psychedelia: 0.5,
        tempo: 0.5,
      },
      deltas: [],
      knownTendencies: [],
      popularPicks: [],
      headlineDescriptor: 'mid-tempo',
      albumsRepresentedRecently: [],
    },
    setCountPrediction: null,
  } as ImprovisedPrediction;
}

describe('SetlistTab — SI-05 hide rule for HypePlaylistCard (pre-show)', () => {
  it('stable prediction renders the hype-card slot (when the page-level gate allows it)', () => {
    // Stable: render with hypePlaylistEnabled=true to confirm the
    // section frame mounts the card when the page gate allows it.
    const { SetlistTab } = SetlistTabMod;
    const { PreviewPlayerProvider } = PreviewPlayerMod;
    const { getByTestId } = render(
      <PreviewPlayerProvider>
        <SetlistTab
          showId="show-1"
          isPast={false}
          artistName={ARTIST}
          prediction={stablePrediction()}
          predictionLoading={false}
          hypePlaylistEnabled
        />
      </PreviewPlayerProvider>,
    );
    assert.ok(getByTestId('hype-card-stub'), 'stable should mount the hype card');
    cleanup();
  });

  it('rotating prediction never renders the hype card (SI-05)', () => {
    const { SetlistTab } = SetlistTabMod;
    // Even if hypePlaylistEnabled is forced true (defense in depth),
    // the rotating branch must not render the card.
    const { queryByTestId } = render(
      <SetlistTab
        showId="show-1"
        isPast={false}
        artistName={ARTIST}
        prediction={rotatingPrediction()}
        predictionLoading={false}
        hypePlaylistEnabled
        rotatingDisplayEnabled
      />,
    );
    assert.equal(
      queryByTestId('hype-card-stub'),
      null,
      'rotating must not render hype card',
    );
    cleanup();
  });

  it('improvised prediction never renders the hype card (SI-05)', () => {
    const { SetlistTab } = SetlistTabMod;
    const { queryByTestId } = render(
      <SetlistTab
        showId="show-1"
        isPast={false}
        artistName={ARTIST}
        prediction={improvisedPrediction()}
        predictionLoading={false}
        hypePlaylistEnabled
        improvisedDisplayEnabled
      />,
    );
    assert.equal(
      queryByTestId('hype-card-stub'),
      null,
      'improvised must not render hype card',
    );
    cleanup();
  });

  it('theatrical prediction keeps the hype card (deterministic + ordering-stable)', () => {
    const { SetlistTab } = SetlistTabMod;
    const { getByTestId } = render(
      <SetlistTab
        showId="show-1"
        isPast={false}
        artistName={ARTIST}
        prediction={theatricalPrediction()}
        predictionLoading={false}
        hypePlaylistEnabled
        theatricalDisplayEnabled
      />,
    );
    assert.ok(getByTestId('hype-card-stub'), 'theatrical should mount the hype card');
    cleanup();
  });
});
