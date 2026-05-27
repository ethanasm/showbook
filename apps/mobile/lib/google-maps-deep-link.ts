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

function buildQuery(v: VenueLocationInput): string {
  if (hasCoords(v)) return `${v.latitude},${v.longitude}`;
  return [v.name, v.city].filter((p): p is string => Boolean(p)).join(', ');
}

/**
 * Build the open-in-Google-Maps plan for a venue. Returns null when
 * we have no useful identifier (no coords, no place id, no name) — the
 * button should be hidden in that case.
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
  const coordsAvailable = hasCoords(v);
  if (!coordsAvailable && !v.googlePlaceId && !v.name) return null;

  const query = buildQuery(v);

  // Native iOS Google Maps app scheme. We always pass coords when we
  // have them so the pin lands on the venue rather than a fuzzy text
  // search result.
  const nativeQuery = coordsAvailable
    ? `${v.latitude},${v.longitude}`
    : encodeURIComponent(query);
  const primary = `comgooglemaps://?q=${nativeQuery}`;

  // Universal Google Maps URL — works in mobile browsers and is
  // claimed by the Google Maps Android app via App Links. `query` is
  // required by the search URL API; `query_place_id` pins the result
  // to the exact venue when we have a Place id.
  const params = new URLSearchParams();
  params.set('api', '1');
  params.set('query', query);
  if (v.googlePlaceId) params.set('query_place_id', v.googlePlaceId);
  const fallback = `https://www.google.com/maps/search/?${params.toString()}`;

  return { primary, fallback };
}
