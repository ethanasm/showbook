import { NextResponse } from 'next/server';
import { db, eq, venues } from '@showbook/db';
import { child } from '@showbook/observability';
import { getPlaceDetails, getPlacePhotoMediaUrl } from '@showbook/api';

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
  // No auth gate: this route is fetched server-side by the Next.js image
  // optimizer, which does not forward request cookies, so requiring a
  // session here always 401s and breaks the venue hero. The venue UUID is
  // unguessable and the bytes proxied are public Google Places photos.
  const { venueId } = await params;
  const [venue] = await db
    .select({ photoUrl: venues.photoUrl, googlePlaceId: venues.googlePlaceId })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);

  if (!venue) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  let photoName = venue.photoUrl;
  let photoNameWasFresh = false;

  // Lazy resolve: venue has a Place ID but no photo resource name yet.
  // Self-heals venues created via TM ingest that haven't been picked up
  // by the daily backfill. Don't persist until we've confirmed the
  // resource name actually serves bytes.
  if (!photoName && venue.googlePlaceId) {
    try {
      photoName = await lookupPhotoName(venue.googlePlaceId);
      photoNameWasFresh = Boolean(photoName);
    } catch (err) {
      log.warn(
        { err, event: 'venue.photo.lazy_resolve_failed', venueId },
        'Lazy photo resolve failed',
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
