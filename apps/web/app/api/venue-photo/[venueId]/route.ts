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

  const response = NextResponse.redirect(mediaUrl, 302);
  response.headers.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  return response;
}
