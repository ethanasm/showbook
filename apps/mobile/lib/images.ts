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

export interface ShowCoverInput {
  id: string;
  coverImageUrl?: string | null;
}

/**
 * Show-cover image source for theatre and festival productions. Returns null
 * when `coverImageUrl` isn't populated yet — callers fall back to whatever
 * they showed before (kind monogram in the row chrome, venue photo on the
 * detail hero, nothing on surfaces that previously displayed nothing).
 *
 * Routes through the `/api/show-cover/<id>` proxy when authenticated so the
 * lazy-resolve and stale-URL recovery in the route can heal rows whose
 * stored TM CDN URL has rotted — same pattern as `performerImageSource`.
 * Falls back to the direct TM CDN URL (which is public) when no token is
 * available, so cached rows still render once the bundle is offline.
 */
export function showCoverImageSource(
  show: ShowCoverInput,
  token: string | null,
): ImageSource | null {
  if (!show.coverImageUrl) return null;
  if (token && API_URL) {
    return {
      uri: `${API_URL}/api/show-cover/${show.id}`,
      headers: { Authorization: `Bearer ${token}` },
    };
  }
  if (/^https?:\/\//i.test(show.coverImageUrl)) {
    return { uri: show.coverImageUrl };
  }
  return null;
}
