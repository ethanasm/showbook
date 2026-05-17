/**
 * Phase 11 §15o — digest spoiler-blur logic unit tests.
 *
 * The `renderPredictedSetlistTile` helper applies the user's
 * setlistSpoilers preference to a prediction summary, deciding
 * between revealing the top 5 song titles or rendering the blur
 * curtain. The matrix covers all three preference values + both
 * style-default-blur states.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderPredictedSetlistTile } from '../notifications';

const stableLikePrediction = {
  songCount: 18,
  confidence: 0.94,
  topTitles: ['Espresso', 'Please Please Please', 'Feather', 'Nonsense', 'Bed Chem'],
  spoilerBlurDefault: true,
};

const rotatingLikePrediction = {
  songCount: 18,
  confidence: 0.41,
  topTitles: ['Tweezer', 'Bug', 'Reba', 'David Bowie', 'Slave to the Traffic Light'],
  spoilerBlurDefault: false,
};

describe('renderPredictedSetlistTile', () => {
  test('always_blur hides titles regardless of style', () => {
    const stable = renderPredictedSetlistTile({
      prediction: stableLikePrediction,
      setlistSpoilers: 'always_blur',
    });
    assert.equal(stable.blurred, true);
    assert.deepEqual(stable.topTitles, []);

    const rotating = renderPredictedSetlistTile({
      prediction: rotatingLikePrediction,
      setlistSpoilers: 'always_blur',
    });
    assert.equal(rotating.blurred, true);
    assert.deepEqual(rotating.topTitles, []);
  });

  test('never_blur reveals titles regardless of style', () => {
    const stable = renderPredictedSetlistTile({
      prediction: stableLikePrediction,
      setlistSpoilers: 'never_blur',
    });
    assert.equal(stable.blurred, false);
    assert.equal(stable.topTitles.length, 5);

    const rotating = renderPredictedSetlistTile({
      prediction: rotatingLikePrediction,
      setlistSpoilers: 'never_blur',
    });
    assert.equal(rotating.blurred, false);
    assert.equal(rotating.topTitles.length, 5);
  });

  test('style_default honors prediction.spoilerBlurDefault', () => {
    const stable = renderPredictedSetlistTile({
      prediction: stableLikePrediction,
      setlistSpoilers: 'style_default',
    });
    assert.equal(stable.blurred, true, 'stable + blurDefault=true → blurred');
    assert.deepEqual(stable.topTitles, []);

    const rotating = renderPredictedSetlistTile({
      prediction: rotatingLikePrediction,
      setlistSpoilers: 'style_default',
    });
    assert.equal(rotating.blurred, false, 'rotating + blurDefault=false → revealed');
    assert.equal(rotating.topTitles.length, 5);
  });

  test('summary line is always populated with N songs + confidence', () => {
    const tile = renderPredictedSetlistTile({
      prediction: stableLikePrediction,
      setlistSpoilers: 'always_blur',
    });
    assert.match(tile.summary, /18 song setlist predicted \(94%\)/);
  });
});
