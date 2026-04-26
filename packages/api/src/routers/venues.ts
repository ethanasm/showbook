import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc';
import { venues, userVenueFollows } from '@showbook/db';
import { getPlaceDetails } from '../google-places';
import { matchOrCreateVenue } from '../venue-matcher';

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
});
