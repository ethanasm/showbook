import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHOW_TAB_KEYS,
  computeShowTabBadges,
  parseShowTab,
} from '../setlist-intel/tab-routing';

describe('SHOW_TAB_KEYS', () => {
  it('renders the fixed order Overview / Setlist / Media / Notes', () => {
    assert.deepEqual([...SHOW_TAB_KEYS], [
      'overview',
      'setlist',
      'media',
      'notes',
    ]);
  });
});

describe('parseShowTab', () => {
  it('falls back to overview for missing / unknown values', () => {
    assert.equal(parseShowTab(null), 'overview');
    assert.equal(parseShowTab(undefined), 'overview');
    assert.equal(parseShowTab(''), 'overview');
    assert.equal(parseShowTab('songs'), 'overview');
  });

  it('returns the canonical key for valid inputs', () => {
    assert.equal(parseShowTab('setlist'), 'setlist');
    assert.equal(parseShowTab('media'), 'media');
    assert.equal(parseShowTab('notes'), 'notes');
    assert.equal(parseShowTab('overview'), 'overview');
  });
});

describe('computeShowTabBadges (pre-show)', () => {
  it('renders the rounded confidence percent on Setlist', () => {
    const badges = computeShowTabBadges({
      isPast: false,
      predictionConfidence: 0.92,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.setlist, '92%');
  });

  it('rounds half-up for confidence display', () => {
    const badges = computeShowTabBadges({
      isPast: false,
      predictionConfidence: 0.875,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.setlist, '88%');
  });

  it('hides the Setlist badge when prediction is cold', () => {
    const badges = computeShowTabBadges({
      isPast: false,
      predictionConfidence: null,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.setlist, null);
  });
});

describe('computeShowTabBadges (post-show)', () => {
  it('shows the actual song count on Setlist', () => {
    const badges = computeShowTabBadges({
      isPast: true,
      predictionConfidence: null,
      actualSongCount: 16,
      mediaCount: 4,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.setlist, '16');
  });

  it('hides the Setlist badge when no songs have landed', () => {
    const badges = computeShowTabBadges({
      isPast: true,
      predictionConfidence: null,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.setlist, null);
  });
});

describe('computeShowTabBadges (media + notes)', () => {
  it('always renders media as a string, including "0"', () => {
    const badges = computeShowTabBadges({
      isPast: false,
      predictionConfidence: null,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.media, '0');
  });

  it('renders the · indicator for non-empty notes only', () => {
    const empty = computeShowTabBadges({
      isPast: true,
      predictionConfidence: null,
      actualSongCount: 5,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(empty.notes, null);
    const present = computeShowTabBadges({
      isPast: true,
      predictionConfidence: null,
      actualSongCount: 5,
      mediaCount: 0,
      notesTrimmedLength: 42,
    });
    assert.equal(present.notes, '·');
  });

  it('overview never has a badge', () => {
    const badges = computeShowTabBadges({
      isPast: true,
      predictionConfidence: 0.9,
      actualSongCount: 16,
      mediaCount: 9,
      notesTrimmedLength: 8,
    });
    assert.equal(badges.overview, null);
  });
});
