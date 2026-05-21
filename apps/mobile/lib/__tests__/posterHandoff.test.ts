import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  consumePendingFestivalPoster,
  setPendingFestivalPoster,
} from '../festival-lineup/posterHandoff';
import type { PickedFestivalImage } from '../festival-lineup/pickFestivalImage';

const sample: PickedFestivalImage = {
  base64: 'iVBORw0KGgo=',
  mimeType: 'image/png',
  uri: 'file:///tmp/poster.png',
};

describe('posterHandoff', () => {
  beforeEach(() => {
    setPendingFestivalPoster(null);
  });

  it('returns null when no poster has been stashed', () => {
    assert.equal(consumePendingFestivalPoster(), null);
  });

  it('returns the stashed poster exactly once', () => {
    setPendingFestivalPoster(sample);
    assert.deepEqual(consumePendingFestivalPoster(), sample);
    assert.equal(consumePendingFestivalPoster(), null);
  });

  it('clears the slot when set to null', () => {
    setPendingFestivalPoster(sample);
    setPendingFestivalPoster(null);
    assert.equal(consumePendingFestivalPoster(), null);
  });
});
