import { z } from 'zod';
import { eq, and, asc, desc, gte, sql, isNotNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import {
  venues,
  userVenueFollows,
  announcements,
  shows,
} from '@showbook/db';
import { getPlaceDetails } from '../google-places';
import { matchOrCreateVenue } from '../venue-matcher';
import { geocodeVenue } from '../geocode';

export const venuesRouter = router({
  search: protectedProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(venues)
        .where(sql`${venues.name} ILIKE ${'%' + input.query + '%'}`)
        .limit(20);
    }),

  follow: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .insert(userVenueFollows)
        .values({ userId, venueId: input.venueId })
        .onConflictDoNothing();

      return { success: true };
    }),

  unfollow: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .delete(userVenueFollows)
        .where(
          and(
            eq(userVenueFollows.userId, userId),
            eq(userVenueFollows.venueId, input.venueId),
          ),
        );

      return { success: true };
    }),

  createFromPlace: protectedProcedure
    .input(z.object({ placeId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const details = await getPlaceDetails(input.placeId);
      if (!details) throw new Error('Place not found');
      const result = await matchOrCreateVenue({
        name: details.name,
        city: details.city,
        stateRegion: details.stateRegion ?? undefined,
        country: details.country,
        lat: details.latitude,
        lng: details.longitude,
        googlePlaceId: details.googlePlaceId,
      });
      return result.venue;
    }),

  followed: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const follows = await ctx.db.query.userVenueFollows.findMany({
      where: eq(userVenueFollows.userId, userId),
      with: { venue: true },
    });

    return follows.map((f) => f.venue);
  }),

  detail: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const [venue] = await ctx.db
        .select()
        .from(venues)
        .where(eq(venues.id, input.venueId))
        .limit(1);

      if (!venue) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Venue not found' });
      }

      const [followRow] = await ctx.db
        .select({ venueId: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(
          and(
            eq(userVenueFollows.userId, userId),
            eq(userVenueFollows.venueId, input.venueId),
          ),
        )
        .limit(1);

      const [{ count: userShowCount } = { count: 0 }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(shows)
        .where(
          and(eq(shows.venueId, input.venueId), eq(shows.userId, userId)),
        );

      const today = new Date().toISOString().slice(0, 10);
      const [{ count: upcomingCount } = { count: 0 }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(announcements)
        .where(
          and(
            eq(announcements.venueId, input.venueId),
            gte(announcements.showDate, today),
          ),
        );

      return {
        ...venue,
        isFollowed: Boolean(followRow),
        userShowCount,
        upcomingCount,
      };
    }),

  upcomingAnnouncements: protectedProcedure
    .input(
      z.object({
        venueId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional().default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const today = new Date().toISOString().slice(0, 10);
      return ctx.db
        .select()
        .from(announcements)
        .where(
          and(
            eq(announcements.venueId, input.venueId),
            gte(announcements.showDate, today),
          ),
        )
        .orderBy(asc(announcements.showDate), asc(announcements.id))
        .limit(input.limit);
    }),

  userShows: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return ctx.db.query.shows.findMany({
        where: and(
          eq(shows.userId, userId),
          eq(shows.venueId, input.venueId),
        ),
        orderBy: [desc(shows.date)],
        with: {
          showPerformers: {
            with: { performer: true },
          },
        },
      });
    }),

  backfillCoordinates: protectedProcedure.mutation(async ({ ctx }) => {
    const incomplete = await ctx.db
      .select()
      .from(venues)
      .where(
        and(
          isNotNull(venues.city),
          sql`${venues.city} != 'Unknown'`,
          sql`(${venues.latitude} IS NULL OR ${venues.stateRegion} IS NULL OR ${venues.stateRegion} = '')`,
        ),
      );

    let geocoded = 0;
    let failed = 0;

    for (const venue of incomplete) {
      try {
        const geo = await geocodeVenue(venue.name, venue.city);
        if (geo) {
          const updates: Record<string, unknown> = {};
          if (venue.latitude == null) {
            updates.latitude = geo.lat;
            updates.longitude = geo.lng;
          }
          if (!venue.stateRegion && geo.stateRegion) updates.stateRegion = geo.stateRegion;
          if ((!venue.country || venue.country === 'US') && geo.country) updates.country = geo.country;
          if (Object.keys(updates).length > 0) {
            await ctx.db
              .update(venues)
              .set(updates)
              .where(eq(venues.id, venue.id));
          }
          geocoded++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    return { total: incomplete.length, geocoded, failed };
  }),
});
