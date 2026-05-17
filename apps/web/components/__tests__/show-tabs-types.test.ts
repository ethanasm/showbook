/**
 * Unit suite for the show-tabs URL routing + badge logic. Pure
 * helpers exercised in isolation; the JSX renderer tests live
 * alongside the components.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeShowTabBadges,
  isHypePlaylistVisible,
  parseShowTab,
  SHOW_TAB_KEYS,
} from '../show-tabs/types';

describe('parseShowTab', () => {
  test('returns "overview" for null', () => {
    assert.equal(parseShowTab(null), 'overview');
  });
  test('returns "overview" for undefined', () => {
    assert.equal(parseShowTab(undefined), 'overview');
  });
  test('returns "overview" for empty string', () => {
    assert.equal(parseShowTab(''), 'overview');
  });
  test('returns "overview" for unknown tab values', () => {
    assert.equal(parseShowTab('not-a-real-tab'), 'overview');
  });
  test('round-trips every canonical tab key', () => {
    for (const key of SHOW_TAB_KEYS) {
      assert.equal(parseShowTab(key), key);
    }
  });
  test('is case-sensitive (URLs are lowercase by convention)', () => {
    // "Setlist" with capital S should not match — URLs use lowercase.
    assert.equal(parseShowTab('Setlist'), 'overview');
  });
});

describe('computeShowTabBadges', () => {
  test('Setlist tab pre-show shows confidence %', () => {
    const badges = computeShowTabBadges({
      isPast: false,
      predictionConfidence: 0.92,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.setlist, '92%');
  });
  test('Setlist tab pre-show rounds the confidence percentage', () => {
    const badges = computeShowTabBadges({
      isPast: false,
      predictionConfidence: 0.846,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.setlist, '85%');
  });
  test('Setlist tab pre-show with no prediction returns null', () => {
    const badges = computeShowTabBadges({
      isPast: false,
      predictionConfidence: null,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.setlist, null);
  });
  test('Setlist tab post-show shows actual song count when > 0', () => {
    const badges = computeShowTabBadges({
      isPast: true,
      predictionConfidence: null,
      actualSongCount: 16,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.setlist, '16');
  });
  test('Setlist tab post-show with no actual setlist returns null', () => {
    const badges = computeShowTabBadges({
      isPast: true,
      predictionConfidence: null,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.setlist, null);
  });
  test('Setlist tab post-show ignores any leftover predictionConfidence', () => {
    // A post-show row that still carries a stale prediction in cache
    // shouldn't surface it as a badge.
    const badges = computeShowTabBadges({
      isPast: true,
      predictionConfidence: 0.84,
      actualSongCount: 14,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.setlist, '14');
  });
  test('Media tab badge is the photo count string (even at zero)', () => {
    const badges = computeShowTabBadges({
      isPast: false,
      predictionConfidence: null,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.media, '0');
  });
  test('Media tab badge updates with photo count', () => {
    const badges = computeShowTabBadges({
      isPast: true,
      predictionConfidence: null,
      actualSongCount: 0,
      mediaCount: 27,
      notesTrimmedLength: 0,
    });
    assert.equal(badges.media, '27');
  });
  test('Notes tab badge is "·" when non-empty, null otherwise', () => {
    const empty = computeShowTabBadges({
      isPast: false,
      predictionConfidence: null,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    assert.equal(empty.notes, null);
    const full = computeShowTabBadges({
      isPast: false,
      predictionConfidence: null,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 5,
    });
    assert.equal(full.notes, '·');
  });
  test('Overview badge is always null', () => {
    const a = computeShowTabBadges({
      isPast: false,
      predictionConfidence: 0.5,
      actualSongCount: 0,
      mediaCount: 0,
      notesTrimmedLength: 0,
    });
    const b = computeShowTabBadges({
      isPast: true,
      predictionConfidence: null,
      actualSongCount: 16,
      mediaCount: 12,
      notesTrimmedLength: 100,
    });
    assert.equal(a.overview, null);
    assert.equal(b.overview, null);
  });
});

describe('SHOW_TAB_KEYS', () => {
  test('order is fixed: overview / setlist / media / notes', () => {
    assert.deepEqual([...SHOW_TAB_KEYS], ['overview', 'setlist', 'media', 'notes']);
  });
});

describe('isHypePlaylistVisible — SI-05', () => {
  test('feature OFF always hides the card', () => {
    for (const style of ['stable', 'rotating', 'theatrical', 'improvised', 'cold']) {
      assert.equal(
        isHypePlaylistVisible({
          featureEnabled: false,
          isPast: false,
          setlistStyle: style,
        }),
        false,
        `style ${style} should hide when feature OFF`,
      );
    }
  });
  test('pre-show: stable + theatrical render the hype card', () => {
    for (const style of ['stable', 'theatrical']) {
      assert.equal(
        isHypePlaylistVisible({
          featureEnabled: true,
          isPast: false,
          setlistStyle: style,
        }),
        true,
        `${style} should render the hype card pre-show`,
      );
    }
  });
  test('pre-show: rotating is hidden (model cannot pick 25 confident songs)', () => {
    assert.equal(
      isHypePlaylistVisible({
        featureEnabled: true,
        isPast: false,
        setlistStyle: 'rotating',
      }),
      false,
    );
  });
  test('pre-show: improvised is hidden (same SI-05 reasoning as rotating)', () => {
    assert.equal(
      isHypePlaylistVisible({
        featureEnabled: true,
        isPast: false,
        setlistStyle: 'improvised',
      }),
      false,
    );
  });
  test('post-show: every style renders the heard card (deterministic from actual setlist)', () => {
    for (const style of ['stable', 'rotating', 'theatrical', 'improvised', 'cold']) {
      assert.equal(
        isHypePlaylistVisible({
          featureEnabled: true,
          isPast: true,
          setlistStyle: style,
        }),
        true,
        `${style} should render the heard card post-show`,
      );
    }
  });
});
