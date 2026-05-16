/**
 * Phase 9 of setlist-intelligence — three-way diff for the
 * Spotify-follow rail on Discover. Asserts the pure diff helper
 * (no DB / no Spotify) honours the contract:
 *
 *   1. Spotify follows pass through when not on Showbook AND not skipped.
 *   2. Showbook-followed names short-circuit (case-insensitive).
 *   3. Skipped Spotify ids short-circuit.
 *   4. Order is preserved from the Spotify input (the rail keeps the
 *      "most-followed-first" order Spotify returns).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSpotifyFollows } from '../spotify-follows-diff';
import type { SpotifyArtist } from '../spotify';

function spotifyArtist(
  id: string,
  name: string,
  genres: string[] = [],
): SpotifyArtist {
  return { id, name, genres, imageUrl: null };
}

describe('diffSpotifyFollows', () => {
  test('returns all spotify artists when nothing is followed or skipped', () => {
    const artists = [
      spotifyArtist('a1', 'Phoebe Bridgers'),
      spotifyArtist('a2', 'Boygenius'),
    ];
    const result = diffSpotifyFollows({
      spotifyArtists: artists,
      showbookFollowedNames: new Set(),
      skippedSpotifyArtistIds: new Set(),
    });
    assert.equal(result.length, 2);
    assert.equal(result[0]?.id, 'a1');
    assert.equal(result[1]?.id, 'a2');
  });

  test('drops artists already followed on Showbook (case-insensitive)', () => {
    const artists = [
      spotifyArtist('a1', 'Phoebe Bridgers'),
      spotifyArtist('a2', 'Boygenius'),
      spotifyArtist('a3', 'MUNA'),
    ];
    const result = diffSpotifyFollows({
      spotifyArtists: artists,
      showbookFollowedNames: new Set(['boygenius', 'muna']),
      skippedSpotifyArtistIds: new Set(),
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, 'a1');
  });

  test('drops artists explicitly skipped on the rail', () => {
    const artists = [
      spotifyArtist('a1', 'Phoebe Bridgers'),
      spotifyArtist('a2', 'Boygenius'),
    ];
    const result = diffSpotifyFollows({
      spotifyArtists: artists,
      showbookFollowedNames: new Set(),
      skippedSpotifyArtistIds: new Set(['a2']),
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, 'a1');
  });

  test('returns empty when every artist is followed or skipped', () => {
    const artists = [
      spotifyArtist('a1', 'Phoebe Bridgers'),
      spotifyArtist('a2', 'Boygenius'),
    ];
    const result = diffSpotifyFollows({
      spotifyArtists: artists,
      showbookFollowedNames: new Set(['phoebe bridgers']),
      skippedSpotifyArtistIds: new Set(['a2']),
    });
    assert.deepEqual(result, []);
  });

  test('preserves the Spotify input order', () => {
    const artists = [
      spotifyArtist('a1', 'C'),
      spotifyArtist('a2', 'A'),
      spotifyArtist('a3', 'B'),
    ];
    const result = diffSpotifyFollows({
      spotifyArtists: artists,
      showbookFollowedNames: new Set(),
      skippedSpotifyArtistIds: new Set(),
    });
    assert.deepEqual(
      result.map((a) => a.id),
      ['a1', 'a2', 'a3'],
    );
  });

  test('skip and follow short-circuits are independent (either suppresses)', () => {
    const artists = [
      spotifyArtist('a1', 'Solo'),
      spotifyArtist('a2', 'Followed Already'),
      spotifyArtist('a3', 'Skipped Already'),
    ];
    const result = diffSpotifyFollows({
      spotifyArtists: artists,
      showbookFollowedNames: new Set(['followed already']),
      skippedSpotifyArtistIds: new Set(['a3']),
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, 'a1');
  });

  test('an artist that is BOTH followed and skipped is still suppressed (no duplicate output)', () => {
    const artists = [spotifyArtist('a1', 'Double Hit')];
    const result = diffSpotifyFollows({
      spotifyArtists: artists,
      showbookFollowedNames: new Set(['double hit']),
      skippedSpotifyArtistIds: new Set(['a1']),
    });
    assert.deepEqual(result, []);
  });
});
