import { autocomplete, getPlaceDetails } from './google-places';

let lastRequestTime = 0;

async function rateLimit() {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastRequestTime = Date.now();
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  stateRegion?: string;
  country?: string;
  googlePlaceId?: string;
  photoUrl?: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  address?: {
    state?: string;
    country?: string;
    country_code?: string;
  };
}

export async function geocodeVenue(
  venueName: string,
  city: string,
): Promise<GeocodeResult | null> {
  // Google Places first — returns googlePlaceId for dedup
  try {
    const suggestions = await autocomplete(`${venueName}, ${city}`, ['establishment']);
    if (suggestions.length > 0) {
      const details = await getPlaceDetails(suggestions[0].placeId);
      if (details && details.latitude && details.longitude) {
        return {
          lat: details.latitude,
          lng: details.longitude,
          stateRegion: details.stateRegion ?? undefined,
          country: details.country ?? undefined,
          googlePlaceId: details.googlePlaceId,
          photoUrl: details.photoUrl ?? undefined,
        };
      }
    }
  } catch { /* Google Places failed; try Nominatim */ }

  // Fallback: Nominatim (no googlePlaceId)
  const headers = { 'User-Agent': 'Showbook/1.0' };
  const queries = [
    `${venueName}, ${city}`,
    `${venueName.replace(/^The /i, '')}, ${city}`,
    `${venueName} ${city.split(',')[0]}`,
  ];

  for (const query of queries) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
    try {
      await rateLimit();
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const results = (await res.json()) as NominatimResult[];
      if (results.length > 0) {
        return {
          lat: parseFloat(results[0].lat),
          lng: parseFloat(results[0].lon),
          stateRegion: results[0].address?.state ?? undefined,
          country: results[0].address?.country ?? undefined,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}
