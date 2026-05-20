import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, eq, venues } from '@showbook/db';
import { child } from '@showbook/observability';
import {
  getPlaceDetails,
  getPlacePhotoMediaUrl,
  getVenue,
  selectBestImage,
} from '@showbook/api';
import { fetchUpstream, isProxyableUrl } from '@/lib/venue-photo-proxy';
import { decodeMobileToken } from '@/lib/mobile-token';
import { isEmailAllowed, readAllowlistFromEnv } from '@/lib/auth-allowlist';
import { resolveTrpcSession } from '../../trpc/[trpc]/resolve-session';

const log = child({ component: 'web.api.venue-photo' });

// Mirrors the tRPC handler so the mobile app — which authenticates with a
// Bearer JWT minted via /api/auth/mobile-token rather than a NextAuth cookie
// — can load venue photos through the same SSRF-guarded proxy the web uses.
const AUTH_SECRET = process.env.AUTH_SECRET;

async function lookupPhotoName(googlePlaceId: string): Promise<string | null> {
  const details = await getPlaceDetails(googlePlaceId);
  return details?.photoUrl ?? null;
}

async function lookupTmVenueImage(tmVenueId: string): Promise<string | null> {
  const venue = await getVenue(tmVenueId);
  return selectBestImage(venue?.images);
}

async function persistPhotoName(venueId: string, photoName: string) {
  await db
    .update(venues)
    .set({ photoUrl: photoName })
    .where(eq(venues.id, venueId));
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const session = await resolveTrpcSession({
    authHeader: req.headers.get('authorization'),
    secret: AUTH_SECRET,
    decode: decodeMobileToken,
    allowlist: readAllowlistFromEnv(),
    isEmailAllowed,
    getCookieSession: async () => {
      const cookieSession = await auth();
      return cookieSession?.user?.id
        ? { user: { id: cookieSession.user.id } }
        : null;
    },
    log,
  });
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const { venueId } = await params;
  const [venue] = await db
    .select({
      photoUrl: venues.photoUrl,
      googlePlaceId: venues.googlePlaceId,
      ticketmasterVenueId: venues.ticketmasterVenueId,
    })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);

  if (!venue) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  let photoName: string | null = venue.photoUrl;
  let photoNameWasFresh = false;

  // Prefer Google Places over Ticketmaster. TM's `venue.images[]` is for
  // ticket-listing grids and surfaces a wordmark logo on a white
  // background for nearly every venue (Sphere, Fillmore, Warfield, Chase
  // Center, etc.) — not a hero photo. Google's top-ranked Places photo,
  // by contrast, is the curated representative shot (typically a
  // high-res exterior or interior). Baseline eval in
  // scripts/compare-venue-photos.mjs.
  const storedIsPlaces = Boolean(photoName) && !photoName!.startsWith('http');

  if (venue.googlePlaceId && !storedIsPlaces) {
    try {
      const fresh = await lookupPhotoName(venue.googlePlaceId);
      if (fresh) {
        photoName = fresh;
        photoNameWasFresh = true;
      }
    } catch (err) {
      log.warn(
        { err, event: 'venue.photo.lazy_resolve_failed', venueId },
        'Lazy photo resolve failed',
      );
    }
  }

  // TM is a fallback only — used when Places returned nothing (or the
  // venue has no Place ID at all). Persist so we don't pay the TM API
  // call on every request.
  if (!photoName && venue.ticketmasterVenueId) {
    try {
      const tmImage = await lookupTmVenueImage(venue.ticketmasterVenueId);
      if (tmImage) {
        photoName = tmImage;
        photoNameWasFresh = true;
      }
    } catch (err) {
      log.warn(
        { err, event: 'venue.photo.tm_lookup_failed', venueId },
        'TM venue image lookup failed',
      );
    }
  }

  if (!photoName) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const isAbsoluteUrl = photoName.startsWith('http');
  // Belt-and-suspenders against SSRF: even though `venueInputSchema`
  // no longer accepts `photoUrl` from tRPC callers, any persisted
  // absolute URL must come from a trusted host. Unknown hosts are
  // rejected before we make the upstream fetch so an attacker can't
  // probe internal services via this proxy.
  if (isAbsoluteUrl && !isProxyableUrl(photoName)) {
    log.warn(
      {
        event: 'venue.photo.proxy.host_not_allowed',
        venueId,
        photoHost: (() => {
          try {
            return new URL(photoName).hostname;
          } catch {
            return null;
          }
        })(),
      },
      'Refusing to proxy a photoUrl whose host is not in the allowlist',
    );
    return new NextResponse('Photo unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const mediaUrl = isAbsoluteUrl
    ? photoName
    : getPlacePhotoMediaUrl(photoName);

  if (!mediaUrl) {
    return new NextResponse('Photo unavailable', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  let { upstream, contentType, ok, refusedRedirectHost } =
    await fetchUpstream(mediaUrl);

  // Stale-name recovery: Google rotates per-photo resource names ~weekly.
  // If upstream errors and we have a Place ID, refresh the resource name
  // and retry once before falling back.
  if (!ok && venue.googlePlaceId && !photoName.startsWith('http')) {
    log.info(
      {
        event: 'venue.photo.refresh_attempt',
        venueId,
        upstreamStatus: upstream.status,
      },
      'Refreshing stale Google Places photo resource name',
    );
    try {
      const refreshed = await lookupPhotoName(venue.googlePlaceId);
      if (refreshed && refreshed !== photoName) {
        const refreshedMediaUrl = getPlacePhotoMediaUrl(refreshed);
        if (refreshedMediaUrl) {
          ({ upstream, contentType, ok, refusedRedirectHost } =
            await fetchUpstream(refreshedMediaUrl));
          if (ok) {
            photoName = refreshed;
            photoNameWasFresh = true;
          }
        }
      }
    } catch (err) {
      log.warn(
        { err, event: 'venue.photo.refresh_failed', venueId },
        'Photo refresh failed',
      );
    }
  }

  if (!ok || !upstream.body) {
    if (refusedRedirectHost !== undefined) {
      log.warn(
        {
          event: 'venue.photo.proxy.redirect_not_allowed',
          venueId,
          redirectHost: refusedRedirectHost || null,
          upstreamStatus: upstream.status,
        },
        'Upstream redirected to a host outside ALLOWED_REDIRECT_HOSTS',
      );
    } else {
      log.warn(
        {
          event: 'venue.photo.proxy.upstream_error',
          venueId,
          photoUrl: photoName,
          upstreamStatus: upstream.status,
          upstreamContentType: contentType,
        },
        'Google Places media fetch failed; serving 502 fallback',
      );
    }
    return new NextResponse('Upstream error', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // Persist now that we've confirmed the resource name actually serves
  // image bytes — avoids storing names that immediately fail.
  if (photoNameWasFresh && photoName !== venue.photoUrl) {
    try {
      await persistPhotoName(venueId, photoName);
      log.info(
        { event: 'venue.photo.persisted', venueId },
        'Persisted resolved Google Places photo resource name',
      );
    } catch (err) {
      log.warn(
        { err, event: 'venue.photo.persist_failed', venueId },
        'Failed to persist photo resource name',
      );
    }
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      // Defense in depth — even though the content-type allowlist already
      // rejects `image/svg+xml`, this CSP ensures the response can't
      // execute scripts, load remote subresources, or run plugins if it
      // were ever opened as a top-level document.
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
