/**
 * Component test: PredictedSetlistRow + TrackPreview wiring (P10
 * follow-up fix #1). Asserts the 24px third-column slot renders the
 * <TrackPreview> button when `showId` is set, and falls back to the
 * empty placeholder when it's not — so the row layout is identical
 * either way (Phase 1 reserved the slot deliberately).
 *
 * The trpc client is mocked via `mock.module` so the
 * `setlistIntel.resolveTrackPreview` hook resolves to a no-op
 * mutation; the test never fires it.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import { mock } from 'node:test';

const stubMutation = {
  mutateAsync: async () => ({
    previewUrl: null,
    spotifyTrackId: null,
  }),
  isPending: false,
  isError: false,
  reset: () => undefined,
};

mock.module('@/lib/trpc', {
  namedExports: {
    trpc: {
      setlistIntel: {
        resolveTrackPreview: {
          useMutation: () => stubMutation,
        },
      },
    },
  },
});

let PredictedSetlistRowMod: typeof import('../show-tabs/PredictedSetlistRow');
let PreviewPlayerMod: typeof import('../../lib/preview-player');

before(async () => {
  PredictedSetlistRowMod = await import('../show-tabs/PredictedSetlistRow');
  PreviewPlayerMod = await import('../../lib/preview-player');
});

beforeEach(() => cleanup());

function renderRow(props: Parameters<typeof PredictedSetlistRowMod.PredictedSetlistRow>[0]) {
  const { PreviewPlayerProvider } = PreviewPlayerMod;
  const { PredictedSetlistRow } = PredictedSetlistRowMod;
  return render(
    <PreviewPlayerProvider>
      <PredictedSetlistRow {...props} />
    </PreviewPlayerProvider>,
  );
}

describe('PredictedSetlistRow + TrackPreview wiring', () => {
  it('renders the TrackPreview button when showId + previewUrl are wired', () => {
    const { getByTestId, queryByTestId } = renderRow({
      position: 1,
      title: 'Greek Song',
      evidence: '12/12',
      showId: 'show-xyz',
      previewUrl: 'https://p/preview.mp3',
      spotifyTrackId: 'sp-track-1',
    });
    const button = getByTestId('track-preview-button');
    assert.ok(button, 'expected TrackPreview button to render');
    // Initial render is enabled — the button can play immediately
    // because it has a cached previewUrl.
    assert.equal(button.getAttribute('aria-label'), 'Play preview');
    assert.equal(button.hasAttribute('disabled'), false);
    // The empty Phase-1 placeholder slot is replaced, not co-rendered.
    assert.equal(queryByTestId('predicted-row-preview-slot'), null);
  });

  it('renders the TrackPreview button with null previewUrl + null trackId — still enabled because lazy resolve can fire on click', () => {
    const { getByTestId } = renderRow({
      position: 2,
      title: 'Unresolved Title',
      evidence: '11/12',
      showId: 'show-xyz',
      previewUrl: null,
      spotifyTrackId: null,
    });
    const button = getByTestId('track-preview-button');
    assert.ok(button);
    // Not unavailable yet — `unavailable` flips only after the click
    // path returns nothing. The initial render must allow the click.
    assert.equal(button.getAttribute('data-unavailable'), 'false');
    assert.equal(button.hasAttribute('disabled'), false);
  });

  it('falls back to the empty 24px slot when showId is omitted (flag-off / non-show contexts)', () => {
    const { getByTestId, queryByTestId } = renderRow({
      position: 3,
      title: 'No Show Context',
      evidence: '8/12',
      // showId intentionally omitted
      previewUrl: null,
      spotifyTrackId: null,
    });
    // The empty placeholder is what the row falls back to so the
    // grid columns don't collapse.
    assert.ok(getByTestId('predicted-row-preview-slot'));
    assert.equal(queryByTestId('track-preview-button'), null);
  });
});

describe('PredictedSetlistRow badge tooltips', () => {
  it('renders Your first + Rare badges with aria-label so the emoji is explained to screen readers, and each badge text is scoped (you/your vs no-prefix for artist-rare)', () => {
    const { getByTestId } = renderRow({
      position: 4,
      title: 'A Rare First Listen',
      evidence: 'actual · setlist.fm',
      badge: {
        firstTime: true,
        rareCatch: { fractionPct: 3 },
      },
    });
    // User-scoped: "Your first" + tooltip carries "you" phrasing.
    const firstTime = getByTestId('predicted-row-badge-first-time');
    assert.match(firstTime.textContent ?? '', /Your first/);
    assert.equal(
      firstTime.getAttribute('aria-label'),
      'The show where you first heard this live',
    );
    // Artist-scoped: 💎 emoji (no longer overloaded 🎯) + tooltip
    // omits "you" so the scope is obvious from the wording.
    const rare = getByTestId('predicted-row-badge-rare');
    assert.match(rare.textContent ?? '', /💎/);
    assert.match(rare.textContent ?? '', /Rare \(3%\)/);
    assert.equal(
      rare.getAttribute('aria-label'),
      'Played in 3% of recent setlists',
    );
  });

  it('renders all four personal-weight chips with the new "you/your" labels and a non-overloaded artist-scope emoji', () => {
    const { getByTestId } = renderRow({
      position: 1,
      title: 'Everything Chip',
      evidence: 'core',
      badge: {
        firstTime: false,
        rareCatch: { fractionPct: 4 },
        saved: true,
        personalFirstTime: true,
        topTrack: true,
      },
    });
    assert.match(getByTestId('predicted-row-badge-saved').textContent ?? '', /Your library/);
    assert.match(
      getByTestId('predicted-row-badge-personal-first-time').textContent ?? '',
      /New to you/,
    );
    assert.match(getByTestId('predicted-row-badge-top-track').textContent ?? '', /Your top 50/);
    assert.match(getByTestId('predicted-row-badge-rare').textContent ?? '', /💎/);
  });
});
