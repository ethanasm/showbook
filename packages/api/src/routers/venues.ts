import { z } from 'zod';
import { eq, and, asc, desc, gte, sql, isNotNull, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import {
  venues,
  userVenueFollows,
  announcements,
  showAnnouncementLinks,
  shows,
} from '@showbook/db';
import { getPlaceDetails } from '../google-places';
import { matchOrCreateVenue, findTmVenueId } from '../venue-matcher';
import { geocodeVenue } from '../geocode';
import { enqueueIngestVenue } from '../job-queue';
import { scrapeConfigSchema, parseScrapeConfig } from '../scrape-config';
import { venueScrapeRuns } from '@showbook/db';

export const venuesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const today = new Date().toISOString().slice(0, 10);

    const rows = await ctx.db
      .select({
        id: venues.id,
        name: venues.name,
        city: venues.city,
        stateRegion: venues.stateRegion,
        country: venues.country,
        googlePlaceId: venues.googlePlaceId,
        ticketmasterVenueId: venues.ticketmasterVenueId,
        pastShowsCount: sql<number>`count(case when ${shows.date} < ${today} then 1 end)::int`,
        futureShowsCount: sql<number>`count(case when ${shows.date} >= ${today} then 1 end)::int`,
      })
      .from(venues)
      .innerJoin(shows, eq(shows.venueId, venues.id))
      .where(eq(shows.userId, userId))
      .groupBy(venues.id);

    const followed = await ctx.db
      .select({ venueId: userVenueFollows.venueId })
      .from(userVenueFollows)
      .where(eq(userVenueFollows.userId, userId));
    const followedSet = new Set(followed.map((f) => f.venueId));

    return rows.map((r) => ({ ...r, isFollowed: followedSet.has(r.id) }));
  }),

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

      try {
        const { ingestVenue } = await import('@showbook/jobs');
        await ingestVenue(input.venueId);
      } catch (err) {
        console.error('[venues/follow] ingestion failed:', err);
      }

      return { success: true };
    }),

  rename: protectedProcedure
    .input(z.object({ venueId: z.string().uuid(), name: z.string().min(1).max(300) }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(venues)
        .set({ name: input.name.trim() })
        .where(eq(venues.id, input.venueId))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Venue not found' });
      return updated;
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

      const [stillFollowed] = await ctx.db
        .select({ userId: userVenueFollows.userId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.venueId, input.venueId))
        .limit(1);

      if (!stillFollowed) {
        const venueAnnouncements = await ctx.db
          .select({ id: announcements.id })
          .from(announcements)
          .where(eq(announcements.venueId, input.venueId));

        if (venueAnnouncements.length > 0) {
          const ids = venueAnnouncements.map((a) => a.id);
          await ctx.db
            .delete(showAnnouncementLinks)
            .where(inArray(showAnnouncementLinks.announcementId, ids));
          await ctx.db
            .delete(announcements)
            .where(eq(announcements.venueId, input.venueId));
        }
      }

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

  /**
   * Save a scrape config (URL + frequency) on a venue. Replaces any existing
   * config. Pass `null` to remove. Visible to anyone who follows the venue.
   * Note: the system prompt is built server-side at scrape time using the
   * venue's name/city/kind history — users do not supply prompt text.
   */
  saveScrapeConfig: protectedProcedure
    .input(
      z.object({
        venueId: z.string().uuid(),
        config: z
          .object({
            url: z.string().url(),
            frequencyDays: z
              .number()
              .int()
              .min(1)
              .max(30)
              .optional()
              .default(7),
          })
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.config === null) {
        await ctx.db
          .update(venues)
          .set({ scrapeConfig: null })
          .where(eq(venues.id, input.venueId));
        return { success: true };
      }
      const config = scrapeConfigSchema.parse({
        type: 'llm',
        url: input.config.url,
        frequencyDays: input.config.frequencyDays,
      });
      await ctx.db
        .update(venues)
        .set({ scrapeConfig: config })
        .where(eq(venues.id, input.venueId));
      return { success: true };
    }),

  /**
   * Read the parsed scrape config + the most recent scrape run for a venue.
   * Used by the venue detail page to render the "Scrape config" section
   * with last-run status.
   */
  scrapeStatus: protectedProcedure
    .input(z.object({ venueId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [venue] = await ctx.db
        .select({ scrapeConfig: venues.scrapeConfig })
        .from(venues)
        .where(eq(venues.id, input.venueId))
        .limit(1);
      if (!venue) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Venue not found' });
      }
      const [lastRun] = await ctx.db
        .select()
        .from(venueScrapeRuns)
        .where(eq(venueScrapeRuns.venueId, input.venueId))
        .orderBy(desc(venueScrapeRuns.startedAt))
        .limit(1);
      return {
        config: parseScrapeConfig(venue.scrapeConfig),
        lastRun: lastRun ?? null,
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

  backfillTicketmaster: protectedProcedure.mutation(async ({ ctx }) => {
    const missing = await ctx.db
      .select()
      .from(venues)
      .where(
        and(
          sql`${venues.ticketmasterVenueId} IS NULL`,
          isNotNull(venues.city),
          sql`${venues.city} != 'Unknown'`,
        ),
      );

    let matched = 0;
    let failed = 0;

    for (const venue of missing) {
      try {
        const tmId = await findTmVenueId(venue.name, venue.city, venue.stateRegion);
        if (tmId) {
          await ctx.db
            .update(venues)
            .set({ ticketmasterVenueId: tmId })
            .where(eq(venues.id, venue.id));
          matched++;
        }
      } catch {
        failed++;
      }
    }

    return { total: missing.length, matched, failed };
  }),
});
