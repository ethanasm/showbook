import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveBadge,
  resolvePreview,
  type BadgePayload,
  type PreviewMap,
} from '../setlist-intel/badge-resolver';

const payload: BadgePayload = {
  badges: {
    'song-a': { firstTime: true, rareCatch: null },
    'song-b': { firstTime: false, rareCatch: { fractionPct: 8 } },
  },
  titleToSongId: {
    'sympathy for the devil': 'song-a',
    'star star': 'song-b',
  },
};

describe('resolveBadge', () => {
  it('returns null badge when payload is missing', () => {
    const result = resolveBadge('Sympathy for the Devil', null);
    assert.equal(result.songId, null);
    assert.equal(result.badge, undefined);
  });

  it('looks the title up case-insensitively', () => {
    const result = resolveBadge('SYMPATHY FOR THE DEVIL', payload);
    assert.equal(result.songId, 'song-a');
    assert.deepEqual(result.badge, { firstTime: true, rareCatch: null });
  });

  it('returns null song id when the title is unknown', () => {
    const result = resolveBadge('Gimme Shelter', payload);
    assert.equal(result.songId, null);
    assert.equal(result.badge, undefined);
  });

  it('exposes the rare-catch fraction when present', () => {
    const result = resolveBadge('Star Star', payload);
    assert.equal(result.songId, 'song-b');
    assert.deepEqual(result.badge, {
      firstTime: false,
      rareCatch: { fractionPct: 8 },
    });
  });
});

describe('resolvePreview', () => {
  const previews: PreviewMap = {
    'sympathy for the devil': {
      previewUrl: 'https://p.scdn.co/abc.mp3',
      spotifyTrackId: 'spotify-id-1',
    },
    'star star': {
      previewUrl: null,
      spotifyTrackId: 'spotify-id-2',
    },
  };

  it('returns nulls when map is missing', () => {
    const result = resolvePreview('Star Star', null);
    assert.deepEqual(result, { previewUrl: null, spotifyTrackId: null });
  });

  it('returns the cached pair for a match', () => {
    const result = resolvePreview('Sympathy for the Devil', previews);
    assert.deepEqual(result, {
      previewUrl: 'https://p.scdn.co/abc.mp3',
      spotifyTrackId: 'spotify-id-1',
    });
  });

  it('returns nulls for an unknown title', () => {
    const result = resolvePreview('Gimme Shelter', previews);
    assert.deepEqual(result, { previewUrl: null, spotifyTrackId: null });
  });

  it('handles a cache row with a null preview but live track id', () => {
    const result = resolvePreview('Star Star', previews);
    assert.deepEqual(result, {
      previewUrl: null,
      spotifyTrackId: 'spotify-id-2',
    });
  });
});
