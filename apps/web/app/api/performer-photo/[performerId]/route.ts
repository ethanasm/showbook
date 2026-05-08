import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, eq, performers } from '@showbook/db';
import { child } from '@showbook/observability';
import {
  getAttraction,
  searchAttractions,
  selectBestImage,
} from '@showbook/api';

const log = child({ component: 'web.api.performer-photo' });

async function fetchUpstream(url: string) {
  const upstream = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = upstream.headers.get('content-type') ?? '';
  const ok =
    upstream.ok && upstream.body && contentType.toLowerCase().startsWith('image/');
  return { upstream, contentType, ok } as const;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function lookupTmImage(
  tmAttractionId: string | null,
  name: string,
): Promise<{ imageUrl: string; tmAttractionId: string | null } | null> {
  if (tmAttractionId) {
    const attraction = await getAttraction(tmAttractionId);
    const imageUrl = selectBestImage(attraction?.images);
    if (imageUrl) return { imageUrl, tmAttractionId: null };
  }

  const candidates = await searchAttractions(name);
  const target = normalizeName(name);
  const match = candidates.find((a) => normalizeName(a.name) === target);
  if (match) {
    const imageUrl = selectBestImage(match.images);
    if (imageUrl) {
      return {
        imageUrl,
        tmAttractionId: tmAttractionId ? null : match.id,
      };
    }
  }
  return null;
}

async function persistImage(
  performerId: string,
  imageUrl: string,
  tmAttractionIdToWrite: string | null,
) {
  const updates: Record<string, string> = { imageUrl };
  if (tmAttractionIdToWrite) {
    updates.ticketmasterAttractionId = tmAttractionIdToWrite;
  }
  try {
    await db
      .update(performers)
      .set(updates)
      .where(eq(performers.id, performerId));
  } catch (err) {
    if (tmAttractionIdToWrite) {
      // Conflicting tmAttractionId on the unique index — fall back to image only.
      await db
        .update(performers)
        .set({ imageUrl })
        .where(eq(performers.id, performerId));
      log.warn(
        { err, event: 'performer.photo.persist_image_only', performerId },
        'Persisted image without TM ID due to conflict',
      );
      return;
    }
    throw err;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ performerId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const { performerId } = await params;
  const [performer] = await db
    .select({
      id: performers.id,
      name: performers.name,
      imageUrl: performers.imageUrl,
      ticketmasterAttractionId: performers.ticketmasterAttractionId,
    })
    .from(performers)
    .where(eq(performers.id, performerId))
    .limit(1);

  if (!performer) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  let imageUrl = performer.imageUrl;
  let tmIdToPersist: string | null = null;
  let isFresh = false;

  // Lazy resolve when nothing is stored. Self-heals performers created via
  // Gmail / manual add / setlist.fm imports that didn't carry a TM image,
  // without waiting for the daily backfill cron.
  if (!imageUrl) {
    try {
      const resolved = await lookupTmImage(
        performer.ticketmasterAttractionId,
        performer.name,
      );
      if (resolved) {
        imageUrl = resolved.imageUrl;
        tmIdToPersist = resolved.tmAttractionId;
        isFresh = true;
      }
    } catch (err) {
      log.warn(
        { err, event: 'performer.photo.lazy_resolve_failed', performerId },
        'Lazy performer image resolve failed',
      );
    }
  }

  if (!imageUrl) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  let { upstream, contentType, ok } = await fetchUpstream(imageUrl);

  // Stale-URL recovery: if a stored URL no longer serves, try a fresh TM
  // lookup once before giving up.
  if (!ok && !isFresh) {
    log.info(
      {
        event: 'performer.photo.refresh_attempt',
        performerId,
        upstreamStatus: upstream.status,
      },
      'Refreshing stale performer image URL',
    );
    try {
      const resolved = await lookupTmImage(
        performer.ticketmasterAttractionId,
        performer.name,
      );
      if (resolved && resolved.imageUrl !== imageUrl) {
        const retry = await fetchUpstream(resolved.imageUrl);
        if (retry.ok) {
          ({ upstream, contentType, ok } = retry);
          imageUrl = resolved.imageUrl;
          tmIdToPersist = resolved.tmAttractionId;
          isFresh = true;
        }
      }
    } catch (err) {
      log.warn(
        { err, event: 'performer.photo.refresh_failed', performerId },
        'Performer image refresh failed',
      );
    }
  }

  if (!ok || !upstream.body) {
    log.warn(
      {
        event: 'performer.photo.proxy.upstream_error',
        performerId,
        imageUrl,
        upstreamStatus: upstream.status,
        upstreamContentType: contentType,
      },
      'Performer image fetch failed; serving 502 fallback',
    );
    return new NextResponse('Upstream error', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (isFresh && imageUrl !== performer.imageUrl) {
    try {
      await persistImage(performerId, imageUrl, tmIdToPersist);
      log.info(
        { event: 'performer.photo.persisted', performerId },
        'Persisted resolved performer image URL',
      );
    } catch (err) {
      log.warn(
        { err, event: 'performer.photo.persist_failed', performerId },
        'Failed to persist performer image URL',
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
