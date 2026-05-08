import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, eq, shows, venues } from '@showbook/db';
import { child } from '@showbook/observability';
import {
  searchAttractions,
  searchEvents,
  selectBestImage,
} from '@showbook/api';

const log = child({ component: 'web.api.show-cover' });

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

interface ShowContext {
  productionName: string;
  date: string | null;
  endDate: string | null;
  tmVenueId: string | null;
}

async function lookupTmImage(
  ctx: ShowContext,
): Promise<string | null> {
  // Path 1: scoped event search by productionName + venue + date window.
  if (ctx.date && ctx.tmVenueId) {
    try {
      const { events } = await searchEvents({
        keyword: ctx.productionName,
        venueId: ctx.tmVenueId,
        startDateTime: `${ctx.date}T00:00:00Z`,
        endDateTime: `${ctx.endDate ?? ctx.date}T23:59:59Z`,
        size: 1,
      });
      const url = selectBestImage(events[0]?.images);
      if (url) return url;
    } catch (err) {
      log.warn(
        { err, event: 'show.cover.event_search_failed', productionName: ctx.productionName },
        'TM event search failed; falling back to attraction search',
      );
    }
  }

  // Path 2: attraction search by name with exact-match guard.
  const candidates = await searchAttractions(ctx.productionName);
  const target = normalizeName(ctx.productionName);
  const match = candidates.find((a) => normalizeName(a.name) === target);
  if (match) return selectBestImage(match.images);

  return null;
}

async function persistCover(showId: string, coverImageUrl: string) {
  await db
    .update(shows)
    .set({ coverImageUrl })
    .where(eq(shows.id, showId));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ showId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const { showId } = await params;

  const [show] = await db
    .select({
      id: shows.id,
      userId: shows.userId,
      kind: shows.kind,
      productionName: shows.productionName,
      coverImageUrl: shows.coverImageUrl,
      date: shows.date,
      endDate: shows.endDate,
      tmVenueId: venues.ticketmasterVenueId,
    })
    .from(shows)
    .leftJoin(venues, eq(shows.venueId, venues.id))
    .where(eq(shows.id, showId))
    .limit(1);

  if (!show || show.userId !== session.user.id) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (!show.productionName) {
    // Concerts/comedy with a headliner go through /api/performer-photo;
    // this proxy is for production-style shows whose art lives on the
    // show row itself.
    return new NextResponse('No production name', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  let imageUrl = show.coverImageUrl;
  let isFresh = false;

  // Lazy resolve on first request, before the daily backfill cron.
  // Self-heals theatre/festival shows added before the cover-image
  // pipeline existed (or that missed enrichment at create time).
  if (!imageUrl) {
    try {
      const resolved = await lookupTmImage({
        productionName: show.productionName,
        date: show.date,
        endDate: show.endDate,
        tmVenueId: show.tmVenueId,
      });
      if (resolved) {
        imageUrl = resolved;
        isFresh = true;
      }
    } catch (err) {
      log.warn(
        { err, event: 'show.cover.lazy_resolve_failed', showId },
        'Lazy show cover resolve failed',
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

  // Stale-URL recovery: if the stored URL no longer serves, try a
  // fresh TM lookup once before giving up.
  if (!ok && !isFresh) {
    log.info(
      {
        event: 'show.cover.refresh_attempt',
        showId,
        upstreamStatus: upstream.status,
      },
      'Refreshing stale show cover URL',
    );
    try {
      const resolved = await lookupTmImage({
        productionName: show.productionName,
        date: show.date,
        endDate: show.endDate,
        tmVenueId: show.tmVenueId,
      });
      if (resolved && resolved !== imageUrl) {
        const retry = await fetchUpstream(resolved);
        if (retry.ok) {
          ({ upstream, contentType, ok } = retry);
          imageUrl = resolved;
          isFresh = true;
        }
      }
    } catch (err) {
      log.warn(
        { err, event: 'show.cover.refresh_failed', showId },
        'Show cover refresh failed',
      );
    }
  }

  if (!ok || !upstream.body) {
    log.warn(
      {
        event: 'show.cover.proxy.upstream_error',
        showId,
        imageUrl,
        upstreamStatus: upstream.status,
        upstreamContentType: contentType,
      },
      'Show cover fetch failed; serving 502',
    );
    return new NextResponse('Upstream error', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (isFresh && imageUrl !== show.coverImageUrl) {
    try {
      await persistCover(showId, imageUrl);
      log.info(
        { event: 'show.cover.persisted', showId },
        'Persisted resolved show cover URL',
      );
    } catch (err) {
      log.warn(
        { err, event: 'show.cover.persist_failed', showId },
        'Failed to persist show cover URL',
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
