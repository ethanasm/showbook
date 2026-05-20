/**
 * Image source helpers shared by the venue cards / hero / list screens.
 *
 * Web renders venue photos through `/api/venue-photo/<venueId>` — a session-
 * gated proxy that resolves Google Places resource names server-side (so the
 * Places API key never reaches the client) and SSRF-guards stored absolute
 * URLs. Mobile needs the same proxy, but authenticates with a Bearer JWT
 * minted via /api/auth/mobile-token instead of the NextAuth session cookie.
 *
 * `venueImageSource` returns the `{ uri, headers? }` pair to feed expo-image
 * via RemoteImage's `uri` + `headers` props:
 *   - absolute URLs (TM image URLs) load directly with no proxy hop
 *   - Places resource names or venues with only a googlePlaceId go through
 *     the proxy with the Bearer header attached so the resolver can run
 *   - venues with no photo signal at all yield null so the monogram
 *     fallback renders without making a doomed request
 */

import { API_URL } from './env';

export interface VenuePhotoInput {
  id: string;
  photoUrl?: string | null;
  googlePlaceId?: string | null;
}

export interface VenueImageSource {
  uri: string;
  headers?: Record<string, string>;
}

export function venueImageSource(
  venue: VenuePhotoInput,
  token: string | null,
): VenueImageSource | null {
  if (venue.photoUrl && /^https?:\/\//i.test(venue.photoUrl)) {
    return { uri: venue.photoUrl };
  }
  if ((venue.photoUrl || venue.googlePlaceId) && token && API_URL) {
    return {
      uri: `${API_URL}/api/venue-photo/${venue.id}`,
      headers: { Authorization: `Bearer ${token}` },
    };
  }
  return null;
}
