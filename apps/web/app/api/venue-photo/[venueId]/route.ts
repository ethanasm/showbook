import { NextResponse } from 'next/server';
import { db, eq, venues } from '@showbook/db';

const PLACES_BASE_URL = 'https://places.googleapis.com/v1';

function getPlacePhotoMediaUrl(photoName: string, maxWidthPx = 1200): string | null {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !photoName) return null;
  const normalized = photoName.replace(/^\/+/, '');
  return `${PLACES_BASE_URL}/${normalized}/media?maxWidthPx=${maxWidthPx}&key=${encodeURIComponent(apiKey)}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const { venueId } = await params;
  const [venue] = await db
    .select({ photoUrl: venues.photoUrl })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);

  if (!venue?.photoUrl) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const mediaUrl = venue.photoUrl.startsWith('http')
    ? venue.photoUrl
    : getPlacePhotoMediaUrl(venue.photoUrl);

  if (!mediaUrl) {
    return new NextResponse('Photo unavailable', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // Proxy the bytes ourselves rather than 302-redirect. Next.js's image
  // optimizer can't follow cross-origin redirects (returns "received null")
  // and the Google Places API key must stay server-side anyway.
  const upstream = await fetch(mediaUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });

  if (!upstream.ok || !upstream.body) {
    return new NextResponse('Upstream error', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
