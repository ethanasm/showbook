import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  pickSetlistView,
  shouldRenderHypePlaylistCard,
} from '../setlist-intel/style-switcher';

describe('pickSetlistView', () => {
  it('returns cold when prediction is null', () => {
    assert.equal(pickSetlistView(null), 'cold');
  });

  it('routes cold style straight through', () => {
    assert.equal(pickSetlistView({ style: 'cold' }), 'cold');
  });

  it('routes stable to the stable view regardless of flags', () => {
    assert.equal(pickSetlistView({ style: 'stable' }), 'stable');
    assert.equal(
      pickSetlistView({ style: 'stable' }, { rotatingDisplayEnabled: false }),
      'stable',
    );
  });

  it('blocks rotating when the display flag is off', () => {
    assert.equal(
      pickSetlistView({ style: 'rotating' }, { rotatingDisplayEnabled: false }),
      'rotating_blocked',
    );
  });

  it('renders rotating when its flag is on', () => {
    assert.equal(
      pickSetlistView({ style: 'rotating' }, { rotatingDisplayEnabled: true }),
      'rotating',
    );
  });

  it('blocks theatrical / improvised when flags are off', () => {
    assert.equal(
      pickSetlistView(
        { style: 'theatrical' },
        { theatricalDisplayEnabled: false },
      ),
      'theatrical_blocked',
    );
    assert.equal(
      pickSetlistView(
        { style: 'improvised' },
        { improvisedDisplayEnabled: false },
      ),
      'improvised_blocked',
    );
  });

  it('renders theatrical / improvised when flags are on', () => {
    assert.equal(
      pickSetlistView(
        { style: 'theatrical' },
        { theatricalDisplayEnabled: true },
      ),
      'theatrical',
    );
    assert.equal(
      pickSetlistView(
        { style: 'improvised' },
        { improvisedDisplayEnabled: true },
      ),
      'improvised',
    );
  });
});

describe('shouldRenderHypePlaylistCard', () => {
  it('always renders the post-show I-Heard card', () => {
    assert.equal(
      shouldRenderHypePlaylistCard({ isPast: true, predictionStyle: null }),
      true,
    );
    assert.equal(
      shouldRenderHypePlaylistCard({
        isPast: true,
        predictionStyle: 'rotating',
      }),
      true,
    );
  });

  it('hides pre-show when prediction is missing or cold', () => {
    assert.equal(
      shouldRenderHypePlaylistCard({ isPast: false, predictionStyle: null }),
      false,
    );
    assert.equal(
      shouldRenderHypePlaylistCard({ isPast: false, predictionStyle: 'cold' }),
      false,
    );
  });

  it('hides pre-show for rotating and improvised (SI-05)', () => {
    assert.equal(
      shouldRenderHypePlaylistCard({
        isPast: false,
        predictionStyle: 'rotating',
      }),
      false,
    );
    assert.equal(
      shouldRenderHypePlaylistCard({
        isPast: false,
        predictionStyle: 'improvised',
      }),
      false,
    );
  });

  it('keeps pre-show for stable and theatrical', () => {
    assert.equal(
      shouldRenderHypePlaylistCard({
        isPast: false,
        predictionStyle: 'stable',
      }),
      true,
    );
    assert.equal(
      shouldRenderHypePlaylistCard({
        isPast: false,
        predictionStyle: 'theatrical',
      }),
      true,
    );
  });
});
