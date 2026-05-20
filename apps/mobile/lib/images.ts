/**
 * Image source helpers shared by the venue / performer cards + hero screens.
 *
 * Web loads photos through session-gated proxy routes — `/api/venue-photo/<id>`
 * for venues and `/api/performer-photo/<id>` for artists. Both routes resolve
 * external API references (Google Places resource names, Ticketmaster
 * attraction lookups) server-side so secrets stay on the server and stale
 * URLs self-heal on demand. Mobile needs the same proxies, but authenticates
 * with a Bearer JWT minted via /api/auth/mobile-token instead of the
 * NextAuth session cookie.
 *
 * The `*ImageSource` helpers return the `{ uri, headers? }` pair to feed
 * expo-image via RemoteImage's `uri` + `headers` props:
 *   - absolute URLs (already-cached TM image URLs) load directly with no
 *     proxy hop
 *   - rows without a stored URL still hit the proxy so the lazy-resolve
 *     branch can populate them — this is how the web manages to render an
 *     image for performers added via Gmail / setlist.fm that never carried
 *     a TM image with them
 *   - when API_URL / token aren't available yet (cold start before sign-in)
 *     return null so RemoteImage renders the monogram fallback rather than
 *     issuing a doomed request
 */

import { API_URL } from './env';

export interface ImageSource {
  uri: string;
  headers?: Record<string, string>;
}

export interface VenuePhotoInput {
  id: string;
  photoUrl?: string | null;
  googlePlaceId?: string | null;
}

export function venueImageSource(
  venue: VenuePhotoInput,
  token: string | null,
): ImageSource | null {
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

export interface PerformerPhotoInput {
  id: string;
  imageUrl?: string | null;
}

/**
 * Always prefer the proxy when authenticated — even if `imageUrl` is already
 * stored — so the lazy-resolve / stale-URL recovery paths in
 * `/api/performer-photo/<id>` can heal rows whose cached URL has rotted.
 * Mirrors how `apps/web/app/(app)/artists/[id]/page.tsx` calls the proxy
 * unconditionally rather than reading `performer.imageUrl` directly.
 */
export function performerImageSource(
  performer: PerformerPhotoInput,
  token: string | null,
): ImageSource | null {
  if (token && API_URL) {
    return {
      uri: `${API_URL}/api/performer-photo/${performer.id}`,
      headers: { Authorization: `Bearer ${token}` },
    };
  }
  if (performer.imageUrl && /^https?:\/\//i.test(performer.imageUrl)) {
    return { uri: performer.imageUrl };
  }
  return null;
}
