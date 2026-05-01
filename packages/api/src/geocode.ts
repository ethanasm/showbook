import { autocomplete, getPlaceDetails } from './google-places';
import { child } from '@showbook/observability';

const log = child({ component: 'api.geocode' });

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
  stateRegion?: string | null,
): Promise<GeocodeResult | null> {
  // Build the autocomplete query. When the caller knows the state (e.g.
  // because Ticketmaster told us so), pass it in so Google disambiguates
  // common venue names worldwide. Without this, "Warfield, San Francisco"
  // sometimes resolves to a Place without lat/lng and we silently fall
  // through to Nominatim, losing the Place ID + photo.
  const stateSuffix = stateRegion ? `, ${stateRegion}` : '';
  const query = `${venueName}, ${city}${stateSuffix}`;

  // Google Places first — returns googlePlaceId for dedup
  try {
    const suggestions = await autocomplete(query, ['establishment']);
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
      log.warn(
        {
          event: 'geocode.google.no_lat_lng',
          name: venueName,
          city,
          stateRegion: stateRegion ?? null,
          placeId: suggestions[0].placeId,
        },
        'Google Places returned a result without lat/lng; falling back to Nominatim (Place ID + photo will be lost)',
      );
    }
  } catch (err) {
    log.warn(
      {
        err,
        event: 'geocode.google.failed',
        name: venueName,
        city,
        stateRegion: stateRegion ?? null,
      },
      'Google Places lookup failed; falling back to Nominatim',
    );
  }

  // Fallback: Nominatim (no googlePlaceId / photoUrl)
  const headers = { 'User-Agent': 'Showbook/1.0' };
  const queries = [
    `${venueName}, ${city}`,
    `${venueName.replace(/^The /i, '')}, ${city}`,
    `${venueName} ${city.split(',')[0]}`,
  ];

  for (const q of queries) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;
    try {
      await rateLimit();
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) {
        log.warn(
          {
            event: 'geocode.nominatim.http_error',
            status: res.status,
            query: q,
          },
          'Nominatim HTTP error; trying next variant',
        );
        continue;
      }
      const results = (await res.json()) as NominatimResult[];
      if (results.length > 0) {
        return {
          lat: parseFloat(results[0].lat),
          lng: parseFloat(results[0].lon),
          stateRegion: results[0].address?.state ?? undefined,
          country: results[0].address?.country ?? undefined,
        };
      }
    } catch (err) {
      log.warn(
        { err, event: 'geocode.nominatim.failed', query: q },
        'Nominatim fetch threw; trying next variant',
      );
      continue;
    }
  }

  return null;
}
