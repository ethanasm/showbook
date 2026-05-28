import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNativeDeepLink,
  buildSpotifyOpenPlan,
  buildSpotifyTrackOpenPlan,
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

describe('buildSpotifyTrackOpenPlan', () => {
  it('returns the native + web plan for a real track id', () => {
    const plan = buildSpotifyTrackOpenPlan('2QsoVMTKj5m5kgztTOep98');
    assert.deepEqual(plan, {
      primary: 'spotify:track:2QsoVMTKj5m5kgztTOep98',
      fallback: 'https://open.spotify.com/track/2QsoVMTKj5m5kgztTOep98',
    });
  });

  it('trims surrounding whitespace', () => {
    const plan = buildSpotifyTrackOpenPlan('  abc123  ');
    assert.equal(plan?.primary, 'spotify:track:abc123');
  });

  it('returns null for the __none__ sentinel from the resolver cache', () => {
    assert.equal(buildSpotifyTrackOpenPlan('__none__'), null);
  });

  it('returns null for null / undefined / empty', () => {
    assert.equal(buildSpotifyTrackOpenPlan(null), null);
    assert.equal(buildSpotifyTrackOpenPlan(undefined), null);
    assert.equal(buildSpotifyTrackOpenPlan(''), null);
    assert.equal(buildSpotifyTrackOpenPlan('   '), null);
  });

  it('refuses non-alphanumeric ids — guards against URL injection', () => {
    assert.equal(buildSpotifyTrackOpenPlan('abc/../foo'), null);
    assert.equal(buildSpotifyTrackOpenPlan('abc?si=x'), null);
    assert.equal(buildSpotifyTrackOpenPlan('javascript:alert(1)'), null);
  });
});
