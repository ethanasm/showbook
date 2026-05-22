import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, eq, shows, venues } from '@showbook/db';
import { child } from '@showbook/observability';
import {
  pickAttractionImage,
  searchAttractions,
  searchEvents,
  selectBestImage,
} from '@showbook/api';
import { fetchUpstream, isProxyableUrl } from '@/lib/image-proxy';
import { decodeMobileToken } from '@/lib/mobile-token';
import { isEmailAllowed, readAllowlistFromEnv } from '@/lib/auth-allowlist';
import { resolveTrpcSession } from '../../trpc/[trpc]/resolve-session';

const log = child({ component: 'web.api.show-cover' });

// Mirrors the tRPC handler so the mobile app — which authenticates with a
// Bearer JWT minted via /api/auth/mobile-token rather than a NextAuth cookie
// — can load show cover images through the same SSRF-guarded proxy the web uses.
const AUTH_SECRET = process.env.AUTH_SECRET;

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

  // Path 2: attraction search. `pickAttractionImage` walks every exact-
  // name match first, then `"<name> (...)"` variants, so we don't get
  // stuck on a stale TM record whose `images[]` is empty when a
  // sibling record carries the real poster. See the matching comment
  // in `packages/jobs/src/backfill-show-cover-images.ts`.
  const candidates = await searchAttractions(ctx.productionName);
  const match = pickAttractionImage(candidates, ctx.productionName);
  if (match) return match;

  return null;
}

async function persistCover(showId: string, coverImageUrl: string) {
  await db
    .update(shows)
    .set({ coverImageUrl })
    .where(eq(shows.id, showId));
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ showId: string }> },
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

  // SSRF guard: `coverImageUrl` flows in from `shows.create` user input
  // (via `coverImageUrl: z.string().url().optional()` on the tRPC
  // mutation) and from `selectBestImage(tmEvent.images)` enrichment.
  // The legitimate value is always a TM CDN URL; refusing anything
  // else here blocks an attacker from pointing the proxy at internal
  // services even if a non-TM URL ever lands in the column.
  if (!isProxyableUrl(imageUrl)) {
    log.warn(
      {
        event: 'show.cover.proxy.host_not_allowed',
        showId,
        photoHost: (() => {
          try {
            return new URL(imageUrl).hostname;
          } catch {
            return null;
          }
        })(),
      },
      'Refusing to proxy a coverImageUrl whose host is not in the allowlist',
    );
    return new NextResponse('Cover unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  let { upstream, contentType, ok, refusedRedirectHost } =
    await fetchUpstream(imageUrl);

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
      if (resolved && resolved !== imageUrl && isProxyableUrl(resolved)) {
        const retry = await fetchUpstream(resolved);
        if (retry.ok) {
          ({ upstream, contentType, ok, refusedRedirectHost } = retry);
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
    if (refusedRedirectHost !== undefined) {
      log.warn(
        {
          event: 'show.cover.proxy.redirect_not_allowed',
          showId,
          redirectHost: refusedRedirectHost || null,
          upstreamStatus: upstream.status,
        },
        'Upstream redirected to a host outside ALLOWED_REDIRECT_HOSTS',
      );
    } else {
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
    }
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
      // Defense in depth — even though the content-type allowlist in
      // `fetchUpstream` already rejects `image/svg+xml`, this CSP
      // ensures the response can't execute scripts, load remote
      // subresources, or run plugins if it were ever opened as a
      // top-level document.
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
