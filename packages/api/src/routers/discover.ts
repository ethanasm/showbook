import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, inArray, asc, sql, notInArray, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc';
import {
  db,
  announcements,
  showAnnouncementLinks,
  shows,
  showPerformers,
  userVenueFollows,
  userPerformerFollows,
  userRegions,
  venues,
} from '@showbook/db';
import { matchOrCreatePerformer } from '../performer-matcher';
import {
  enqueueIngestVenue,
  enqueueIngestPerformer,
  isRegionIngestPending,
  getPendingIngests,
} from '../job-queue';
import { searchAttractions, selectBestImage } from '../ticketmaster';

// ---------------------------------------------------------------------------
// Cursor-based pagination, composite (showDate, id) to match ORDER BY.
// Cursor format: "YYYY-MM-DD|<uuid>".
// ---------------------------------------------------------------------------

const paginationInput = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export function decodeCursor(cursor?: string): { showDate: string; id: string } | null {
  if (!cursor) return null;
  const parts = cursor.split('|');
  if (parts.length !== 2) return null;
  const [showDate, id] = parts;
  if (!showDate || !id) return null;
  return { showDate, id };
}

export function encodeCursor(showDate: string, id: string): string {
  return `${showDate}|${id}`;
}

// In-memory per-user rate limit for refreshNow. Resets on server restart,
// which is fine — the worst case is a few extra TM API calls.
const REFRESH_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const refreshTimestamps = new Map<string, number>();

function cursorCondition(cursor: { showDate: string; id: string }) {
  // (showDate, id) > (cursor.showDate, cursor.id) under ORDER BY ASC, ASC.
  return or(
    sql`${announcements.showDate} > ${cursor.showDate}`,
    and(
      eq(announcements.showDate, cursor.showDate),
      sql`${announcements.id} > ${cursor.id}`,
    ),
  )!;
}

// ---------------------------------------------------------------------------
// Discover Router
// ---------------------------------------------------------------------------

export const discoverRouter = router({
  /**
   * Feed of announcements at venues the user follows.
   * Ordered by showDate ascending, cursor-paginated by announcement ID.
   */
  followedFeed: protectedProcedure
    .input(paginationInput)
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const { cursor, limit } = input;

      // Get all venue IDs the user follows
      const followedVenues = await db
        .select({ venueId: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.userId, userId));

      const venueIds = followedVenues.map((v) => v.venueId);

      if (venueIds.length === 0) {
        return { items: [], nextCursor: undefined };
      }

      // Build conditions
      const conditions = [inArray(announcements.venueId, venueIds)];
      const decoded = decodeCursor(cursor);
      if (decoded) {
        conditions.push(cursorCondition(decoded));
      }

      const rows = await db
        .select({
          announcement: announcements,
          venue: venues,
        })
        .from(announcements)
        .innerJoin(venues, eq(announcements.venueId, venues.id))
        .where(and(...conditions))
        .orderBy(asc(announcements.showDate), asc(announcements.id))
        .limit(limit + 1);

      let nextCursor: string | undefined;
      if (rows.length > limit) {
        const extra = rows.pop()!;
        nextCursor = encodeCursor(extra.announcement.showDate, extra.announcement.id);
      }

      return {
        items: rows.map((r) => ({
          ...r.announcement,
          ticketUrl: r.announcement.ticketUrl
            || (r.announcement.sourceEventId
              ? `https://www.ticketmaster.com/event/${r.announcement.sourceEventId}`
              : null),
          venue: r.venue,
        })),
        nextCursor,
      };
    }),

  /**
   * Feed of announcements headlined by performers the user follows.
   * Mirrors followedFeed shape so the UI can render it the same way.
   */
  followedArtistsFeed: protectedProcedure
    .input(paginationInput)
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const { cursor, limit } = input;

      const followedPerformers = await db
        .select({ performerId: userPerformerFollows.performerId })
        .from(userPerformerFollows)
        .where(eq(userPerformerFollows.userId, userId));

      const performerIds = followedPerformers.map((p) => p.performerId);
      if (performerIds.length === 0) {
        return { items: [], nextCursor: undefined };
      }

      const conditions = [
        inArray(announcements.headlinerPerformerId, performerIds),
      ];
      const decoded = decodeCursor(cursor);
      if (decoded) {
        conditions.push(cursorCondition(decoded));
      }

      const rows = await db
        .select({ announcement: announcements, venue: venues })
        .from(announcements)
        .innerJoin(venues, eq(announcements.venueId, venues.id))
        .where(and(...conditions))
        .orderBy(asc(announcements.showDate), asc(announcements.id))
        .limit(limit + 1);

      let nextCursor: string | undefined;
      if (rows.length > limit) {
        const extra = rows.pop()!;
        nextCursor = encodeCursor(extra.announcement.showDate, extra.announcement.id);
      }

      return {
        items: rows.map((r) => ({
          ...r.announcement,
          ticketUrl: r.announcement.ticketUrl
            || (r.announcement.sourceEventId
              ? `https://www.ticketmaster.com/event/${r.announcement.sourceEventId}`
              : null),
          venue: r.venue,
        })),
        nextCursor,
      };
    }),

  /**
   * Feed of upcoming announcements at nearby (but not followed) venues.
   *
   * Single OR'd bbox query against announcements ⨝ venues, then per-region
   * assignment in JS (smallest matching radius wins). Replaces the earlier
   * one-query-per-region implementation, which could drop announcements at
   * an overlapping bbox edge: rows fetched by a larger region's 250-row cap
   * but later reassigned to a smaller region used up the larger region's
   * window without contributing to it.
   *
   * Cursors are still per-region so the client can scroll regions
   * independently. Each region gets up to perRegionLimit items in this
   * page; the (perRegionLimit+1)th row that lands in a region becomes its
   * nextCursor.
   */
  nearbyFeed: protectedProcedure
    .input(
      z.object({
        cursors: z.record(z.string(), z.string()).optional(),
        perRegionLimit: z
          .number()
          .int()
          .min(1)
          .max(250)
          .optional()
          .default(250),
      }),
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const { cursors = {}, perRegionLimit } = input;

      const regions = await db
        .select()
        .from(userRegions)
        .where(
          and(eq(userRegions.userId, userId), eq(userRegions.active, true)),
        );

      if (regions.length === 0) {
        return { items: [], nextCursors: {}, hasRegions: false };
      }

      const followedVenues = await db
        .select({ venueId: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.userId, userId));

      const followedVenueIds = followedVenues.map((v) => v.venueId);

      const regionBboxes = regions.map((region) => {
        const latDelta = region.radiusMiles / 69.0;
        const lngDelta =
          region.radiusMiles /
          (69.0 * Math.cos((region.latitude * Math.PI) / 180));
        return {
          region,
          minLat: region.latitude - latDelta,
          maxLat: region.latitude + latDelta,
          minLng: region.longitude - lngDelta,
          maxLng: region.longitude + lngDelta,
        };
      });

      // OR every region's (bbox AND its own cursor). A row qualifies if it
      // lies in at least one region whose cursor it is past.
      const regionClauses: SQL[] = regionBboxes.map(
        ({ region, minLat, maxLat, minLng, maxLng }) => {
          const clauses: SQL[] = [
            sql`${venues.latitude} BETWEEN ${minLat} AND ${maxLat}`,
            sql`${venues.longitude} BETWEEN ${minLng} AND ${maxLng}`,
          ];
          const decoded = decodeCursor(cursors[region.id]);
          if (decoded) clauses.push(cursorCondition(decoded));
          return and(...clauses)!;
        },
      );

      const conditions: SQL[] = [
        sql`${announcements.showDate} >= CURRENT_DATE`,
        or(...regionClauses)!,
      ];
      if (followedVenueIds.length > 0) {
        conditions.push(notInArray(announcements.venueId, followedVenueIds));
      }

      // Generous global cap (regions × perRegionLimit + 1) capped at 1500 so
      // a dense region can't starve others while still not blowing memory.
      const globalLimit = Math.min(
        regions.length * (perRegionLimit + 1),
        1500,
      );

      const rows = await db
        .select({ announcement: announcements, venue: venues })
        .from(announcements)
        .innerJoin(venues, eq(announcements.venueId, venues.id))
        .where(and(...conditions))
        .orderBy(asc(announcements.showDate), asc(announcements.id))
        .limit(globalLimit);

      function findRegionForVenue(lat: number | null, lng: number | null) {
        if (lat == null || lng == null) return null;
        let best: (typeof regionBboxes)[0] | null = null;
        for (const bbox of regionBboxes) {
          if (
            lat >= bbox.minLat &&
            lat <= bbox.maxLat &&
            lng >= bbox.minLng &&
            lng <= bbox.maxLng
          ) {
            if (!best || bbox.region.radiusMiles < best.region.radiusMiles) {
              best = bbox;
            }
          }
        }
        return best;
      }

      // Walk rows in (date, id) order, assigning each to its smallest
      // matching region. We track the last emitted row per region; if a
      // region has more rows past its cap we emit a cursor that advances
      // strictly past the last emitted row, so page N+1 picks up exactly
      // where page N stopped.
      //
      // Cursor filtering also runs in JS: a row that satisfies the OR'd
      // SQL because it falls in another region's bbox could still be
      // assigned to a region whose cursor it precedes (because it shares
      // both bboxes). We skip those here so cursor pagination is correct
      // when regions overlap.
      const perRegionCounts = new Map<string, number>();
      const lastEmitted = new Map<
        string,
        { showDate: string; id: string }
      >();
      const overflowed = new Set<string>();
      const items: Array<
        (typeof announcements.$inferSelect) & {
          ticketUrl: string | null;
          venue: typeof venues.$inferSelect;
          regionId: string | null;
          regionCityName: string | null;
          regionRadiusMiles: number | null;
        }
      > = [];

      function pastCursor(
        regionId: string,
        showDate: string,
        id: string,
      ): boolean {
        const c = decodeCursor(cursors[regionId]);
        if (!c) return true;
        if (showDate > c.showDate) return true;
        if (showDate < c.showDate) return false;
        return id > c.id;
      }

      for (const r of rows) {
        const match = findRegionForVenue(r.venue.latitude, r.venue.longitude);
        if (!match) continue;
        if (
          !pastCursor(match.region.id, r.announcement.showDate, r.announcement.id)
        ) {
          continue;
        }
        const count = perRegionCounts.get(match.region.id) ?? 0;
        if (count >= perRegionLimit) {
          overflowed.add(match.region.id);
          continue;
        }
        perRegionCounts.set(match.region.id, count + 1);
        lastEmitted.set(match.region.id, {
          showDate: r.announcement.showDate,
          id: r.announcement.id,
        });
        items.push({
          ...r.announcement,
          ticketUrl:
            r.announcement.ticketUrl ||
            (r.announcement.sourceEventId
              ? `https://www.ticketmaster.com/event/${r.announcement.sourceEventId}`
              : null),
          venue: r.venue,
          regionId: match.region.id,
          regionCityName: match.region.cityName,
          regionRadiusMiles: match.region.radiusMiles,
        });
      }

      const nextCursors: Record<string, string> = {};
      for (const regionId of overflowed) {
        const last = lastEmitted.get(regionId);
        if (last) nextCursors[regionId] = encodeCursor(last.showDate, last.id);
      }

      return { items, nextCursors, hasRegions: true };
    }),

  /**
   * Returns whether a region's discover ingest job is still queued/running.
   * Used by the Near You tab to show a "Discovering shows…" indicator while
   * a just-added region is still being populated.
   */
  regionIngestStatus: protectedProcedure
    .input(z.object({ regionId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      // Only allow checking status for the user's own regions.
      const [region] = await db
        .select({ id: userRegions.id })
        .from(userRegions)
        .where(
          and(
            eq(userRegions.id, input.regionId),
            eq(userRegions.userId, userId),
          ),
        )
        .limit(1);
      if (!region) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Region not found' });
      }
      const pending = await isRegionIngestPending(input.regionId);
      return { pending };
    }),

  /**
   * Snapshot of which followed venues / performers / regions have a queued
   * or in-flight ingest job. The Discover view polls this every 2s while
   * any ingest is running to drive the loading indicators and to refresh
   * feeds the moment a job completes.
   *
   * Pending = created | retry | active (matches isRegionIngestPending).
   */
  ingestStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [followedVenues, followedPerformers, regionRows] = await Promise.all([
      db
        .select({ id: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.userId, userId)),
      db
        .select({ id: userPerformerFollows.performerId })
        .from(userPerformerFollows)
        .where(eq(userPerformerFollows.userId, userId)),
      db
        .select({ id: userRegions.id })
        .from(userRegions)
        .where(
          and(eq(userRegions.userId, userId), eq(userRegions.active, true)),
        ),
    ]);

    return getPendingIngests({
      venueIds: followedVenues.map((r) => r.id),
      performerIds: followedPerformers.map((r) => r.id),
      regionIds: regionRows.map((r) => r.id),
    });
  }),

  /**
   * Search Ticketmaster for attractions to follow as artists.
   */
  searchArtists: protectedProcedure
    .input(z.object({ keyword: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const attractions = await searchAttractions(input.keyword);
        return attractions.slice(0, 10).map((a) => ({
          id: a.id,
          name: a.name,
          imageUrl: selectBestImage(a.images) ?? null,
          mbid: a.externalLinks?.musicbrainz?.[0]?.id ?? null,
        }));
      } catch {
        return [];
      }
    }),

  /**
   * Add an announcement to the user's watchlist by creating a show
   * with state='watching' and linking it to the announcement.
   *
   * For a multi-night non-festival run (runEndDate > runStartDate), the show
   * is created with date=NULL — the user picks a specific performance later
   * from the Shows list. Festivals are a single experience, so they keep
   * date=endpoints: date=start, endDate=end.
   */
  watchlist: protectedProcedure
    .input(
      z.object({
        announcementId: z.string().uuid(),
        // Optional: if the user explicitly picked a date when watching a
        // run, set it now instead of going through the dateless flow.
        performanceDate: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      const [announcement] = await db
        .select()
        .from(announcements)
        .where(eq(announcements.id, input.announcementId))
        .limit(1);

      if (!announcement) {
        throw new Error('Announcement not found');
      }

      if (announcement.kind === 'sports') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Sports events cannot be added to your watchlist',
        });
      }

      const isRun =
        announcement.runStartDate !== null &&
        announcement.runEndDate !== null &&
        announcement.runStartDate !== announcement.runEndDate;
      const isDatePickingRun = isRun && announcement.kind !== 'festival';

      const showDate: string | null = input.performanceDate
        ? input.performanceDate
        : isDatePickingRun
          ? null
          : announcement.runStartDate ?? announcement.showDate;

      const showEndDate =
        announcement.kind === 'festival'
          ? announcement.runEndDate ?? announcement.runStartDate ?? announcement.showDate
          : null;

      let performerId = announcement.headlinerPerformerId;
      if (!performerId) {
        // matchOrCreatePerformer can hit external APIs and may take its own
        // db connection. Run it before opening the transaction to avoid
        // holding a tx open while waiting on Ticketmaster.
        const { performer } = await matchOrCreatePerformer({
          name: announcement.headliner,
        });
        performerId = performer.id;
      }

      // Atomic: show + headliner row + announcement link all-or-nothing.
      // Without this, a failure mid-flight leaves a show with no performer.
      const show = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(shows)
          .values({
            userId,
            kind: announcement.kind,
            state: 'watching',
            venueId: announcement.venueId,
            date: showDate,
            endDate: showEndDate,
            productionName:
              isRun || announcement.kind === 'festival'
                ? announcement.productionName ?? announcement.headliner
                : null,
            ticketUrl: announcement.ticketUrl,
          })
          .returning();

        await tx.insert(showPerformers).values({
          showId: created.id,
          performerId,
          role: 'headliner',
          sortOrder: 0,
        });

        await tx.insert(showAnnouncementLinks).values({
          showId: created.id,
          announcementId: input.announcementId,
        });

        return created;
      });

      return show;
    }),

  /**
   * Set or clear the performance date on a watching show that came from a
   * multi-night run announcement.
   */
  pickDate: protectedProcedure
    .input(
      z.object({
        showId: z.string().uuid(),
        performanceDate: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const [show] = await db
        .select({ id: shows.id, userId: shows.userId })
        .from(shows)
        .where(eq(shows.id, input.showId))
        .limit(1);
      if (!show || show.userId !== userId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Show not found' });
      }
      await db
        .update(shows)
        .set({ date: input.performanceDate })
        .where(eq(shows.id, input.showId));
      return { success: true };
    }),

  /**
   * Manually refresh discover ingestion for the current user. Rate-limited
   * to once per hour per user via an in-memory map; survives a single
   * server lifetime, which is enough for v1 (a restart resets the map and
   * the worst case is a few extra TM API calls).
   */
  refreshNow: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = Date.now();
    const last = refreshTimestamps.get(userId) ?? 0;
    const elapsed = now - last;
    if (elapsed < REFRESH_COOLDOWN_MS) {
      const minutes = Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 60000);
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `You just refreshed — try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      });
    }
    refreshTimestamps.set(userId, now);

    // Enqueue a targeted ingest for every venue and performer the user
    // follows. The weekly cron is the same logic at the cluster level;
    // this just runs it for one user on demand. Await all sends so the
    // jobs are visible to ingestStatus before this mutation resolves —
    // the client invalidates ingestStatus on success and needs the jobs
    // to be queryable for the loading indicator to light up immediately.
    const venueRows = await db
      .select({ venueId: userVenueFollows.venueId })
      .from(userVenueFollows)
      .where(eq(userVenueFollows.userId, userId));
    const performerRows = await db
      .select({ performerId: userPerformerFollows.performerId })
      .from(userPerformerFollows)
      .where(eq(userPerformerFollows.userId, userId));

    await Promise.all([
      ...venueRows.map((row) => enqueueIngestVenue(row.venueId)),
      ...performerRows.map((row) =>
        enqueueIngestPerformer(row.performerId),
      ),
    ]);

    return {
      enqueuedVenues: venueRows.length,
      enqueuedPerformers: performerRows.length,
      venueIds: venueRows.map((r) => r.venueId),
      performerIds: performerRows.map((r) => r.performerId),
    };
  }),

  /**
   * Remove an announcement from the user's watchlist by deleting
   * the linked show and the link itself.
   */
  unwatchlist: protectedProcedure
    .input(z.object({ announcementId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      // Find the show linked to this announcement for the current user
      const [link] = await db
        .select({
          showId: showAnnouncementLinks.showId,
        })
        .from(showAnnouncementLinks)
        .innerJoin(shows, eq(showAnnouncementLinks.showId, shows.id))
        .where(
          and(
            eq(showAnnouncementLinks.announcementId, input.announcementId),
            eq(shows.userId, userId),
          ),
        )
        .limit(1);

      if (!link) {
        throw new Error('No watchlist entry found for this announcement');
      }

      // show_announcement_links and show_performers cascade on shows.id.
      await db.delete(shows).where(eq(shows.id, link.showId));

      return { success: true };
    }),
});
