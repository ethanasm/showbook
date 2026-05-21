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

  it('routes stable to the stable view', () => {
    assert.equal(pickSetlistView({ style: 'stable' }), 'stable');
  });

  it('routes rotating to the rotating view', () => {
    assert.equal(pickSetlistView({ style: 'rotating' }), 'rotating');
  });

  it('routes theatrical / improvised to their respective views', () => {
    assert.equal(pickSetlistView({ style: 'theatrical' }), 'theatrical');
    assert.equal(pickSetlistView({ style: 'improvised' }), 'improvised');
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
