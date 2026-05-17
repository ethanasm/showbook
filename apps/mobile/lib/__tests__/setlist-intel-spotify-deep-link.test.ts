import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNativeDeepLink,
  buildSpotifyOpenPlan,
  buildWebUrl,
  extractPlaylistId,
} from '../setlist-intel/spotify-deep-link';

describe('extractPlaylistId', () => {
  it('parses the https URL shape', () => {
    assert.equal(
      extractPlaylistId('https://open.spotify.com/playlist/37i9dQZF1DZ06evO0Ne1ka'),
      '37i9dQZF1DZ06evO0Ne1ka',
    );
  });

  it('parses the https URL with query string', () => {
    assert.equal(
      extractPlaylistId(
        'https://open.spotify.com/playlist/37i9dQZF1DZ06evO0Ne1ka?si=abc',
      ),
      '37i9dQZF1DZ06evO0Ne1ka',
    );
  });

  it('parses the spotify: URI shape', () => {
    assert.equal(
      extractPlaylistId('spotify:playlist:37i9dQZF1DZ06evO0Ne1ka'),
      '37i9dQZF1DZ06evO0Ne1ka',
    );
  });

  it('parses the spotify:// deep-link shape', () => {
    assert.equal(
      extractPlaylistId('spotify://playlist/37i9dQZF1DZ06evO0Ne1ka'),
      '37i9dQZF1DZ06evO0Ne1ka',
    );
  });

  it('trims surrounding whitespace', () => {
    assert.equal(
      extractPlaylistId('  https://open.spotify.com/playlist/abc123  '),
      'abc123',
    );
  });

  it('returns null for unrecognised input', () => {
    assert.equal(extractPlaylistId(null), null);
    assert.equal(extractPlaylistId(undefined), null);
    assert.equal(extractPlaylistId(''), null);
    assert.equal(extractPlaylistId('https://example.com/foo'), null);
    assert.equal(extractPlaylistId('spotify:track:abc'), null);
  });
});

describe('buildNativeDeepLink + buildWebUrl', () => {
  it('round-trip from id', () => {
    assert.equal(
      buildNativeDeepLink('abc123'),
      'spotify://playlist/abc123',
    );
    assert.equal(
      buildWebUrl('abc123'),
      'https://open.spotify.com/playlist/abc123',
    );
  });
});

describe('buildSpotifyOpenPlan', () => {
  it('prefers the native deep link with web fallback', () => {
    const plan = buildSpotifyOpenPlan(
      'https://open.spotify.com/playlist/abc123',
    );
    assert.equal(plan.primary, 'spotify://playlist/abc123');
    assert.equal(plan.fallback, 'https://open.spotify.com/playlist/abc123');
  });

  it('uses the raw URL on both sides when parsing fails', () => {
    const plan = buildSpotifyOpenPlan('https://example.com/foo');
    assert.equal(plan.primary, 'https://example.com/foo');
    assert.equal(plan.fallback, 'https://example.com/foo');
  });

  it('handles null/empty by returning empty strings', () => {
    const plan = buildSpotifyOpenPlan(null);
    assert.equal(plan.primary, '');
    assert.equal(plan.fallback, '');
  });
});
