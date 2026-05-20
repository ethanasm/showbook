/**
 * Project the Groq-extracted festival meta into the `venue` payload that
 * `shows.create` accepts.
 *
 * Posters rarely carry a fully-resolved "Venue Name, City, State" — the
 * extractor returns whatever it could read into `venueHint`. Three shapes
 * we routinely see, and how we resolve each:
 *
 *   "Citi Field, NYC"  → name = "Citi Field", city = "NYC"
 *   "Napa Valley"      → name = festival || hint, city = "Napa Valley"
 *                        (lone locations are more naturally city-like than
 *                        venue-like for festivals)
 *   null / missing     → name = festival || "TBA", city = "TBA"
 *
 * The server enforces `venue.city.min(1)`, so we always emit something
 * non-empty — but never the literal string "Unknown", which the previous
 * implementation hardcoded and which then leaked into the show detail
 * subtitle as "Napa Valley · Unknown".
 */

import type { FestivalLineupMeta } from './useFestivalLineup';

export interface FestivalVenuePayload {
  name: string;
  city: string;
}

export function parseFestivalVenue(meta: FestivalLineupMeta): FestivalVenuePayload {
  const hint = meta.venueHint?.trim() ?? '';
  const festival = meta.festivalName?.trim() ?? '';
  if (hint.includes(',')) {
    const [namePart, ...rest] = hint.split(',');
    const name = namePart?.trim() ?? '';
    const city = rest.join(',').trim();
    if (name && city) return { name, city };
  }
  if (hint) {
    return { name: festival || hint, city: hint };
  }
  return { name: festival || 'TBA', city: 'TBA' };
}
