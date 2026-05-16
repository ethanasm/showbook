/**
 * Phase 9 of setlist-intelligence — three-way diff for the
 * Spotify-follow rail on Discover.
 *
 * The rail surfaces artists the user follows **on Spotify** but
 * NOT on Showbook, minus anyone the user has explicitly skipped.
 * Tapping Follow runs the existing import path; tapping × adds
 * the artist's Spotify id to `user_spotify_skipped_artists`.
 *
 * The pure diff helper is extracted so it can be unit-tested
 * without standing up Spotify / Postgres. The router glue lives
 * in `routers/setlist-intel.ts`.
 */

import type { SpotifyArtist } from './spotify';

export interface ShowbookFollowedPerformerLite {
  /** Performer's name, lowercased for matching. */
  nameLower: string;
}

export interface DiffSpotifyFollowsInput {
  /** Everything the user follows on Spotify (from `getFollowedArtists`). */
  spotifyArtists: SpotifyArtist[];
  /** Performers the user already follows on Showbook (lowercased name). */
  showbookFollowedNames: Set<string>;
  /** Spotify artist ids the user has explicitly skipped. */
  skippedSpotifyArtistIds: Set<string>;
}

/**
 * Pure diff. Returns Spotify artists that:
 *   1. Are followed on Spotify,
 *   2. Are NOT already followed on Showbook (case-insensitive name match), and
 *   3. Have NOT been skipped on the rail.
 *
 * Name matching is intentionally lossy — a Spotify artist whose
 * display name differs from any local performer's canonical name
 * will fall through and surface on the rail; we accept that over
 * the alternative of resolving each Spotify id through
 * Ticketmaster on every query.
 */
export function diffSpotifyFollows(
  input: DiffSpotifyFollowsInput,
): SpotifyArtist[] {
  const out: SpotifyArtist[] = [];
  for (const artist of input.spotifyArtists) {
    if (input.skippedSpotifyArtistIds.has(artist.id)) continue;
    if (input.showbookFollowedNames.has(artist.name.toLowerCase())) continue;
    out.push(artist);
  }
  return out;
}
