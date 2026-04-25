import { z } from 'zod';
import { eq, and, inArray, asc, gt, sql, notInArray } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc';
import {
  db,
  announcements,
  showAnnouncementLinks,
  shows,
  showPerformers,
  userVenueFollows,
  userRegions,
  venues,
} from '@showbook/db';
import { matchOrCreatePerformer } from '../performer-matcher';

// ---------------------------------------------------------------------------
// Shared input schema for cursor-based pagination
// ---------------------------------------------------------------------------

const paginationInput = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

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
      if (cursor) {
        conditions.push(gt(announcements.id, cursor));
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
        nextCursor = extra.announcement.id;
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

      if (cursor) {
        conditions.push(gt(announcements.id, cursor));
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
        nextCursor = extra.announcement.id;
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
   */
  watchlist: protectedProcedure
    .input(z.object({ announcementId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;

      // Fetch the announcement
      const [announcement] = await db
        .select()
        .from(announcements)
        .where(eq(announcements.id, input.announcementId))
        .limit(1);

      if (!announcement) {
        throw new Error('Announcement not found');
      }

      // Match or create the performer for the headliner
      const { performer } = await matchOrCreatePerformer({
        name: announcement.headliner,
      });

      // Create the show
      const [show] = await db
        .insert(shows)
        .values({
          userId,
          kind: announcement.kind,
          state: 'watching',
          venueId: announcement.venueId,
          date: announcement.showDate,
        })
        .returning();

      // Create show_performers row
      await db.insert(showPerformers).values({
        showId: show.id,
        performerId: performer.id,
        role: 'headliner',
        sortOrder: 1,
      });

      // Create showAnnouncementLink row
      await db.insert(showAnnouncementLinks).values({
        showId: show.id,
        announcementId: input.announcementId,
      });

      return show;
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
