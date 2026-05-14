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

const log = child({ component: 'web.api.venue-photo' });

async function fetchUpstream(mediaUrl: string) {
  const upstream = await fetch(mediaUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = upstream.headers.get('content-type') ?? '';
  const ok =
    upstream.ok && upstream.body && contentType.toLowerCase().startsWith('image/');
  return { upstream, contentType, ok } as const;
}

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
  _req: Request,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const session = await auth();
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

  const mediaUrl = photoName.startsWith('http')
    ? photoName
    : getPlacePhotoMediaUrl(photoName);

  if (!mediaUrl) {
    return new NextResponse('Photo unavailable', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  let { upstream, contentType, ok } = await fetchUpstream(mediaUrl);

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
          ({ upstream, contentType, ok } = await fetchUpstream(refreshedMediaUrl));
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
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
