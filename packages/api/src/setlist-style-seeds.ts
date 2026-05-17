/**
 * Curated seed list of well-known performers whose setlist style is
 * known a-priori. Used by the nightly setlist-style-refresh cron to
 * tag fresh performers before the auto-classifier accumulates enough
 * corpus to disagree (≥5 setlists + three consecutive disagreement
 * runs per `reconcileStyleTransition`).
 *
 * Keyed by MusicBrainz id — same join key the corpus-fill jobs use.
 * Source of truth for the IDs is musicbrainz.org; spelled out below so
 * a reviewer can verify each entry without leaving the file.
 *
 * Adding an entry is cheap; getting it wrong is also cheap because the
 * auto-classifier overrides after three consecutive disagreements.
 *
 * Spec: showbook-specs/setlist-intelligence/implementation.md §11 Q3,
 *       showbook-specs/setlist-intelligence/phases/phase-05-style-classifier-rotating.md
 */

import type { SetlistStyle } from './setlist-style';

interface SetlistStyleSeed {
  name: string;
  style: SetlistStyle;
}

// All MBIDs verified against musicbrainz.org listings. Lower-case so a
// consumer normalising their incoming MBID can do a case-insensitive
// lookup.
const SEEDS: Record<string, SetlistStyleSeed> = {
  // Rotating (jam-band & classic-rock improviser tradition)
  '04212d57-7e5e-4e74-b5b6-4dd2c2e62a45': { name: 'Phish', style: 'rotating' },
  '83d91898-7763-47d7-b03b-b92132375c47': { name: 'Pearl Jam', style: 'rotating' },
  '70248960-cb53-4ea4-943a-edb18f7d336f': { name: 'Bruce Springsteen', style: 'rotating' },
  '54a8254a-bb17-418a-a601-39a5cebd0bef': { name: 'Wilco', style: 'rotating' },
  'a563cb55-15f6-4b04-b88e-1ce42ecda3ad': { name: "Umphrey's McGee", style: 'rotating' },
  'eef91d9e-3bb6-4e72-8b29-2eebe1d50ba7': { name: 'Goose', style: 'rotating' },
  '2d33e58f-0ace-46ba-bb84-37c2f51322c5': { name: 'Dead & Company', style: 'rotating' },
  'cea21858-3717-43c6-9b29-fa6cd35d6d61': { name: 'Grateful Dead', style: 'rotating' },
  '83b9cbe7-9857-49e2-ab8e-b57b01038103': { name: 'King Gizzard & The Lizard Wizard', style: 'improvised' },
  'a74b1b7f-71a5-4011-9441-d0b5e4122711': { name: 'Radiohead', style: 'rotating' },
  '0c751690-c784-4a4f-b1e4-c1de27d47581': { name: 'String Cheese Incident', style: 'rotating' },
  '53eb47ac-f00d-4a48-918b-fa0a464dd5cf': { name: "Widespread Panic", style: 'rotating' },

  // Stable (top-down structured pop / rock tour pop)
  '8d6cbd4c-6a3c-4d57-a8c6-1d6f24858e72': { name: 'Tate McRae', style: 'stable' },
  '20244d07-534f-4eff-b4d4-930878889970': { name: 'Taylor Swift', style: 'stable' },
  '4d5447d7-c61c-4120-ba1b-d7f471d385b9': { name: 'Coldplay', style: 'stable' },
  'b30c50dd-9956-4063-9a3a-bda50ba74cbf': { name: 'Sabrina Carpenter', style: 'stable' },
  '7f43dccd-f0e8-432a-8da2-99b2bb3d9c8b': { name: 'Olivia Rodrigo', style: 'stable' },

  // Theatrical (residency / scripted show)
  '859d0860-d480-4efd-970c-c05d5f1776b8': { name: 'Beyoncé', style: 'theatrical' },
};

/**
 * Look up the seed style for a performer's MBID. Returns null when no
 * seed exists for the artist. MBID lookup is case-insensitive (the
 * production data is canonical-lowercase but we normalise defensively).
 */
export function lookupSeedStyle(musicbrainzId: string | null | undefined): SetlistStyle | null {
  if (!musicbrainzId) return null;
  const seed = SEEDS[musicbrainzId.toLowerCase()];
  return seed?.style ?? null;
}

/** Iteration helper — used by the refresh cron's structured logging. */
export function allSeedEntries(): Array<{ mbid: string; name: string; style: SetlistStyle }> {
  return Object.entries(SEEDS).map(([mbid, entry]) => ({
    mbid,
    name: entry.name,
    style: entry.style,
  }));
}
