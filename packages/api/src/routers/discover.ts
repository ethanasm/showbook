import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, inArray, asc, sql, notInArray, or } from 'drizzle-orm';
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
} from '../job-queue';

// ---------------------------------------------------------------------------
// Cursor-based pagination, composite (showDate, id) to match ORDER BY.
// Cursor format: "YYYY-MM-DD|<uuid>".
// ---------------------------------------------------------------------------

const paginationInput = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

function decodeCursor(cursor?: string): { showDate: string; id: string } | null {
  if (!cursor) return null;
  const parts = cursor.split('|');
  if (parts.length !== 2) return null;
  const [showDate, id] = parts;
  if (!showDate || !id) return null;
  return { showDate, id };
}

function encodeCursor(showDate: string, id: string): string {
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
        items: rows.map((r) => ({ ...r.announcement, venue: r.venue })),
        nextCursor,
      };
    }),

  /**
   * Feed of announcements at nearby (but not followed) venues.
   * Uses a bounding-box approximation of the user's active regions.
   */
  nearbyFeed: protectedProcedure
    .input(paginationInput)
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const { cursor, limit } = input;

      // Get user's active regions
      const regions = await db
        .select()
        .from(userRegions)
        .where(
          and(eq(userRegions.userId, userId), eq(userRegions.active, true)),
        );

      if (regions.length === 0) {
        return { items: [], nextCursor: undefined, hasRegions: false };
      }

      // Get followed venue IDs to exclude
      const followedVenues = await db
        .select({ venueId: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.userId, userId));

      const followedVenueIds = followedVenues.map((v) => v.venueId);

      // Build bounding-box conditions for each region (OR'd together)
      const regionConditions = regions.map((region) => {
        const latDelta = region.radiusMiles / 69.0;
        const lngDelta =
          region.radiusMiles /
          (69.0 * Math.cos((region.latitude * Math.PI) / 180));

        const minLat = region.latitude - latDelta;
        const maxLat = region.latitude + latDelta;
        const minLng = region.longitude - lngDelta;
        const maxLng = region.longitude + lngDelta;

        return sql`(
          ${venues.latitude} BETWEEN ${minLat} AND ${maxLat}
          AND ${venues.longitude} BETWEEN ${minLng} AND ${maxLng}
        )`;
      });

      const regionFilter = sql`(${sql.join(regionConditions, sql` OR `)})`;

      // Build conditions
      const conditions = [regionFilter];

      if (followedVenueIds.length > 0) {
        conditions.push(
          notInArray(announcements.venueId, followedVenueIds),
        );
      }

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
          venue: r.venue,
        })),
        nextCursor,
        hasRegions: true,
      };
    }),

  /**
   * Add an announcement to the user's watchlist by creating a show
   * with state='watching' and linking it to the announcement.
   *
   * For a multi-night run (runEndDate > runStartDate), the show is created
   * with date=NULL — the user picks a specific performance later from the
   * Shows list. For single-night announcements, the date is set to showDate.
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

      const isRun =
        announcement.runStartDate !== null &&
        announcement.runEndDate !== null &&
        announcement.runStartDate !== announcement.runEndDate;

      const showDate: string | null = input.performanceDate
        ? input.performanceDate
        : isRun
          ? null
          : announcement.showDate;

      const { performer } = await matchOrCreatePerformer({
        name: announcement.headliner,
      });

      const [show] = await db
        .insert(shows)
        .values({
          userId,
          kind: announcement.kind,
          state: 'watching',
          venueId: announcement.venueId,
          date: showDate,
          productionName: isRun ? announcement.headliner : null,
        })
        .returning();

      await db.insert(showPerformers).values({
        showId: show.id,
        performerId: performer.id,
        role: 'headliner',
        sortOrder: 1,
      });

      await db.insert(showAnnouncementLinks).values({
        showId: show.id,
        announcementId: input.announcementId,
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
    // this just runs it for one user on demand.
    const venueRows = await db
      .select({ venueId: userVenueFollows.venueId })
      .from(userVenueFollows)
      .where(eq(userVenueFollows.userId, userId));
    for (const row of venueRows) {
      void enqueueIngestVenue(row.venueId);
    }
    const performerRows = await db
      .select({ performerId: userPerformerFollows.performerId })
      .from(userPerformerFollows)
      .where(eq(userPerformerFollows.userId, userId));
    for (const row of performerRows) {
      void enqueueIngestPerformer(row.performerId);
    }

    return {
      enqueuedVenues: venueRows.length,
      enqueuedPerformers: performerRows.length,
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

      // Delete the showAnnouncementLink
      await db
        .delete(showAnnouncementLinks)
        .where(
          and(
            eq(showAnnouncementLinks.showId, link.showId),
            eq(showAnnouncementLinks.announcementId, input.announcementId),
          ),
        );

      // Delete the show (cascade will also clean up show_performers
      // since showId FK on shows is the source of truth)
      await db.delete(shows).where(eq(shows.id, link.showId));

      return { success: true };
    }),
});
