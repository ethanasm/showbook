/**
 * Mobile Google-Maps deep-link resolver for the venue detail hero.
 *
 * Tapping "Open in Google Maps" should hand off to the native Google
 * Maps app when installed (`comgooglemaps://...`), else fall back to
 * the universal `https://www.google.com/maps/...` URL. The React
 * layer in `app/venues/[id].tsx` wires these helpers up to
 * `Linking.openURL` with the same try/catch pattern as the Spotify
 * button — see `setlist-intel/spotify-deep-link.ts` for the sibling
 * implementation.
 *
 * URL strategy (the user's expectation is "open the venue's place
 * page with reviews/photos", not "drop a pin at coordinates"):
 *
 * - **Web fallback** uses Google's documented Maps URL API and pins
 *   the result to the venue's place card with `query_place_id` when
 *   we have a Google Places id, so the user lands on the place page
 *   with reviews, photos, hours, etc. `query` is required by the
 *   API even when `query_place_id` is set.
 * - **Native iOS scheme** (`comgooglemaps://`) has no documented
 *   `place_id` parameter, so we pass the venue name (+ city) to `q`.
 *   That performs a search that lands on the place card for the
 *   venue — passing lat/lng would just drop a pin without place info.
 */

export interface VenueLocationInput {
  name: string;
  latitude: number | null;
  longitude: number | null;
  googlePlaceId: string | null;
  city?: string | null;
}

export interface GoogleMapsOpenPlan {
  /** URL to attempt first (native iOS Google Maps app scheme). */
  primary: string;
  /** Universal web URL — opens Google Maps app on Android via App Links, browser elsewhere. */
  fallback: string;
}

function hasCoords(v: VenueLocationInput): v is VenueLocationInput & {
  latitude: number;
  longitude: number;
} {
  return (
    typeof v.latitude === 'number' &&
    Number.isFinite(v.latitude) &&
    typeof v.longitude === 'number' &&
    Number.isFinite(v.longitude)
  );
}

function buildSearchQuery(v: VenueLocationInput): string | null {
  const nameCity = [v.name, v.city]
    .filter((p): p is string => Boolean(p))
    .join(', ');
  if (nameCity) return nameCity;
  // Last-resort fallback when the venue row has no name (shouldn't
  // happen — `venues.name.notNull()` — but the input type allows it).
  if (hasCoords(v)) return `${v.latitude},${v.longitude}`;
  return null;
}

/**
 * Build the open-in-Google-Maps plan for a venue. Returns null when
 * we have nothing to look up — the button should be hidden in that
 * case.
 *
 * Caller pattern (mirrors `HypePlaylistCard.openExisting`):
 *
 *   const plan = buildGoogleMapsOpenPlan(venue);
 *   if (!plan) return null;
 *   try { await Linking.openURL(plan.primary); return; } catch {}
 *   try { await WebBrowser.openBrowserAsync(plan.fallback); }
 *   catch { await Linking.openURL(plan.fallback); }
 */
export function buildGoogleMapsOpenPlan(
  v: VenueLocationInput,
): GoogleMapsOpenPlan | null {
  const query = buildSearchQuery(v);
  if (!query) return null;

  const primary = `comgooglemaps://?q=${encodeURIComponent(query)}`;

  const params = new URLSearchParams();
  params.set('api', '1');
  params.set('query', query);
  if (v.googlePlaceId) params.set('query_place_id', v.googlePlaceId);
  const fallback = `https://www.google.com/maps/search/?${params.toString()}`;

  return { primary, fallback };
}
