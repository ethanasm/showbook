/**
 * Venue geocoding: Google Places first, Nominatim as fallback.
 *
 * The ordering, the failover, the per-provider pacing and the "this answer is
 * thinner than the good one" bookkeeping all come from `provider-router`, so
 * what is left here is the only part that is actually about geocoding — how
 * each provider says "I can't", and how its payload maps onto `GeocodeResult`.
 *
 * Two behaviours that used to be implicit are now typed:
 *
 * - **Nominatim results are `DEGRADED`.** They carry coordinates but no
 *   `googlePlaceId` and no `photoUrl`, which callers want (`matchOrCreateVenue`
 *   dedups on the Place ID, the venue-photo backfill needs the photo). Usable,
 *   but not the good answer — so the router keeps looking before settling, and
 *   `result.degraded` says which one you got.
 * - **Nominatim's one-call-per-second usage policy is per-provider pacing**
 *   (`minInterval`), not a module-level `lastRequestTime` that every caller
 *   shared whether or not it was about to hit Nominatim.
 *
 * The public signature is unchanged: seven call sites depend on
 * `geocodeVenue(name, city, stateRegion?) → GeocodeResult | null`.
 */

import {
  AllProvidersFailed,
  breakerConfig,
  type Deadline,
  type Failure,
  Outcome,
  type Provider,
  rateLimited,
  Router,
  terminal,
  transient,
} from 'provider-router';

import { autocomplete, getPlaceDetails } from './google-places';
import { isTransientFetchError, transientErrorCode } from './transient-fetch';
import { child } from '@showbook/observability';

const log = child({ component: 'api.geocode' });

export interface GeocodeResult {
  // Canonical display name from the upstream provider. Set when Google
  // Places returns a `displayName`; left undefined for the Nominatim
  // fallback path (OSM doesn't return a clean venue name). Callers that
  // want a "clean" venue name (e.g. matchOrCreateVenue replacing a
  // verbose Gmail-extracted name) should prefer this over the input.
  name?: string;
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

interface GeocodeQuery {
  venueName: string;
  city: string;
  stateRegion?: string | null;
}

/**
 * This provider has no answer for this query.
 *
 * Terminal rather than transient: asking Google the same thing again returns
 * the same nothing. Terminal is per-provider, so the router still falls over
 * to Nominatim — which is exactly the old behaviour, now stated rather than
 * implied by control flow.
 */
class GeocodeMiss extends Error {}

/** Nominatim answered, but not with a 2xx. */
class NominatimHttpError extends Error {
  readonly status: number;
  /** Seconds the server asked us to wait, when it said. */
  readonly retryAfter?: number;

  constructor(status: number, retryAfter?: number) {
    super(`Nominatim returned ${status}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** `Retry-After` in seconds, if the header is present and a plain number. */
function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function classifyFetchFailure(err: unknown, fallback: (m: string, c?: unknown) => Failure): Failure {
  if (isTransientFetchError(err)) {
    return transient(`transient fetch failure (${transientErrorCode(err)})`, err);
  }
  return fallback(err instanceof Error ? err.message : String(err), err);
}

class GooglePlacesGeocoder implements Provider<GeocodeQuery, GeocodeResult> {
  readonly name = 'google_places';

  supports(): boolean {
    return true;
  }

  async invoke(query: GeocodeQuery): Promise<GeocodeResult> {
    // When the caller knows the state (e.g. because Ticketmaster told us so),
    // pass it in so Google disambiguates common venue names worldwide.
    // Without it, "Warfield, San Francisco" sometimes resolves to a Place
    // without lat/lng and we lose the Place ID + photo.
    const stateSuffix = query.stateRegion ? `, ${query.stateRegion}` : '';
    // No type filter: Places API (New) treats `establishment` as an umbrella
    // that excludes leaves like `performing_arts_theater` / `concert_hall`, so
    // filtering on it drops Broadway theatres and similar venues entirely.
    const suggestions = await autocomplete(`${query.venueName}, ${query.city}${stateSuffix}`);
    if (suggestions.length === 0) {
      throw new GeocodeMiss('no autocomplete suggestions');
    }

    const details = await getPlaceDetails(suggestions[0].placeId);
    if (!details?.latitude || !details.longitude) {
      log.warn(
        {
          event: 'geocode.google.no_lat_lng',
          name: query.venueName,
          city: query.city,
          stateRegion: query.stateRegion ?? null,
          placeId: suggestions[0].placeId,
        },
        'Google Places returned a result without lat/lng; falling back to Nominatim (Place ID + photo will be lost)',
      );
      throw new GeocodeMiss('place has no coordinates');
    }

    return {
      name: details.name || undefined,
      lat: details.latitude,
      lng: details.longitude,
      stateRegion: details.stateRegion ?? undefined,
      country: details.country ?? undefined,
      googlePlaceId: details.googlePlaceId,
      photoUrl: details.photoUrl ?? undefined,
    };
  }

  classify(err: unknown): Failure {
    if (err instanceof GeocodeMiss) return terminal(err.message, err);
    return classifyFetchFailure(err, terminal);
  }

  assess(): Outcome {
    // Coordinates plus the Place ID and photo the callers actually want.
    return Outcome.OK;
  }
}

class NominatimGeocoder implements Provider<GeocodeQuery, GeocodeResult> {
  readonly name = 'nominatim';

  supports(): boolean {
    return true;
  }

  /**
   * Three name variants, tried in order, inside one invocation.
   *
   * The variants are this provider's business, not the router's — an adapter
   * owns whatever it does internally to produce one answer.
   */
  async invoke(query: GeocodeQuery, deadline: Deadline): Promise<GeocodeResult> {
    const variants = [
      `${query.venueName}, ${query.city}`,
      `${query.venueName.replace(/^The /i, '')}, ${query.city}`,
      `${query.venueName} ${query.city.split(',')[0]}`,
    ];

    let lastError: unknown;
    for (const q of variants) {
      if (deadline.expired()) break;
      try {
        const result = await this.search(q, deadline);
        if (result) return result;
      } catch (err) {
        lastError = err;
        log.warn(
          {
            err,
            event:
              err instanceof NominatimHttpError
                ? 'geocode.nominatim.http_error'
                : 'geocode.nominatim.failed',
            query: q,
            ...(err instanceof NominatimHttpError ? { status: err.status } : {}),
          },
          'Nominatim variant failed; trying next',
        );
      }
    }

    // A rate limit on the last variant must reach the router as a rate limit,
    // not as a generic miss: it is what opens the circuit and honours the
    // Retry-After instead of hammering a throttled public endpoint.
    if (lastError) throw lastError;
    throw new GeocodeMiss('no Nominatim match for any name variant');
  }

  private async search(q: string, deadline: Deadline): Promise<GeocodeResult | null> {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;
    const timeoutMs = Math.min(8_000, Math.max(1_000, deadline.remaining() * 1000));
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Showbook/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new NominatimHttpError(res.status, parseRetryAfter(res));

    const results = (await res.json()) as NominatimResult[];
    if (results.length === 0) return null;
    return {
      lat: parseFloat(results[0].lat),
      lng: parseFloat(results[0].lon),
      stateRegion: results[0].address?.state ?? undefined,
      country: results[0].address?.country ?? undefined,
    };
  }

  classify(err: unknown): Failure {
    if (err instanceof NominatimHttpError) {
      // A server that names its own cooldown is believed: the router opens the
      // circuit for exactly that long rather than making it say so three times.
      if (err.status === 429) return rateLimited(err.message, err.retryAfter, err);
      if (err.status >= 500) return transient(err.message, err);
      return terminal(err.message, err);
    }
    if (err instanceof GeocodeMiss) return terminal(err.message, err);
    return classifyFetchFailure(err, terminal);
  }

  assess(): Outcome {
    // Coordinates, but no Place ID and no photo. Useful; not the good answer.
    return Outcome.DEGRADED;
  }
}

/**
 * One router for the process.
 *
 * Deliberately module-level: the breaker's cooldowns and Nominatim's pacing
 * are only meaningful if they persist across calls. A router per call would
 * make both no-ops — which is what the old module-level `lastRequestTime` was
 * groping toward.
 */
let router: Router<GeocodeQuery, GeocodeResult> | undefined;

function geocodeRouter(): Router<GeocodeQuery, GeocodeResult> {
  router ??= new Router<GeocodeQuery, GeocodeResult>(
    [new GooglePlacesGeocoder(), new NominatimGeocoder()],
    {
      // 1.1s honours Nominatim's one-call-per-second usage policy with margin.
      providerConfigs: { nominatim: breakerConfig({ minInterval: 1.1 }) },
      defaultTimeout: 30,
      events: (e) => log.debug({ event: e.name, provider: e.provider, ...e.fields }, 'geocode route'),
    },
  );
  return router;
}

/** Drop the router's breaker + pacing state. Tests only. */
export function resetGeocodeRouter(): void {
  router = undefined;
}

export async function geocodeVenue(
  venueName: string,
  city: string,
  stateRegion?: string | null,
): Promise<GeocodeResult | null> {
  try {
    const route = await geocodeRouter().invoke({ venueName, city, stateRegion });
    if (route.degraded) {
      log.warn(
        {
          event: 'geocode.degraded',
          provider: route.provider,
          name: venueName,
          city,
          stateRegion: stateRegion ?? null,
        },
        'Geocoded without a Place ID or photo; venue dedup and photo backfill will be thinner',
      );
    }
    return route.value;
  } catch (err) {
    if (err instanceof AllProvidersFailed) {
      // Every provider missed. Same `null` the callers have always handled.
      log.warn(
        {
          event: 'geocode.exhausted',
          name: venueName,
          city,
          stateRegion: stateRegion ?? null,
          attempts: err.attempts.map((a) => a.provider),
        },
        'No geocoder could resolve this venue',
      );
      return null;
    }
    throw err;
  }
}
