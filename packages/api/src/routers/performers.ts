import { z } from 'zod';
import { eq, and, ne, sql, desc, count, max, min, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { performers, userPerformerFollows, shows, showPerformers, announcements, venues, userVenueFollows, userRegions } from '@showbook/db';
import { enqueueIngestPerformer } from '../job-queue';
import { computePerformerAnnouncementsToDelete } from './preferences';
import { searchAttractions, selectBestImage } from '../ticketmaster';
import { matchOrCreatePerformer } from '../performer-matcher';
import { child } from '@showbook/observability';

const log = child({ component: 'api.performers' });

export const performersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const today = new Date().toISOString().slice(0, 10);

    const rows = await ctx.db
      .select({
        id: performers.id,
        name: performers.name,
        imageUrl: performers.imageUrl,
        musicbrainzId: performers.musicbrainzId,
        ticketmasterAttractionId: performers.ticketmasterAttractionId,
        showCount: count(shows.id),
        pastShowsCount: sql<number>`count(case when ${shows.date} < ${today} then 1 end)::int`,
        futureShowsCount: sql<number>`count(case when ${shows.date} >= ${today} then 1 end)::int`,
        lastSeen: max(shows.date),
        firstSeen: min(shows.date),
      })
      .from(showPerformers)
      .innerJoin(performers, eq(showPerformers.performerId, performers.id))
      .innerJoin(shows, eq(showPerformers.showId, shows.id))
      .where(and(eq(shows.userId, userId), ne(shows.kind, 'theatre')))
      .groupBy(performers.id, performers.name, performers.imageUrl, performers.musicbrainzId, performers.ticketmasterAttractionId)
      .orderBy(desc(max(shows.date)));

    const followed = await ctx.db
      .select({ performerId: userPerformerFollows.performerId })
      .from(userPerformerFollows)
      .where(eq(userPerformerFollows.userId, userId));

    const followedSet = new Set(followed.map((f) => f.performerId));
    return rows.map((r) => ({ ...r, isFollowed: followedSet.has(r.id) }));
  }),

  /**
   * Count of distinct performers across the user's non-theatre shows —
   * matches the row count returned by `list` so sidebar badges stay
   * consistent. Avoids hydrating the full performer list just for `.length`.
   */
  count: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [row] = await ctx.db
      .select({
        count: sql<number>`count(distinct ${showPerformers.performerId})::int`,
      })
      .from(showPerformers)
      .innerJoin(shows, eq(showPerformers.showId, shows.id))
      .where(and(eq(shows.userId, userId), ne(shows.kind, 'theatre')));
    return row?.count ?? 0;
  }),

  search: protectedProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(performers)
        .where(sql`${performers.name} ILIKE ${'%' + input.query + '%'}`)
        .limit(20);
    }),

  /**
   * Search Ticketmaster for attractions (artists/performers/productions) not
   * yet in our local DB, so users can follow artists they haven't seen
   * before. Returns lightweight cards; followAttraction below does the
   * actual match-or-create + follow.
   */
  searchExternal: protectedProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const attractions = await searchAttractions(input.query);
        return attractions.slice(0, 10).map((a) => ({
          tmAttractionId: a.id,
          name: a.name,
          imageUrl: selectBestImage(a.images),
        }));
      } catch (err) {
        log.error({ err, event: 'performers.search_external.failed', query: input.query }, 'searchExternal failed');
        return [];
      }
    }),

  /**
   * Resolve a TM attraction into a local performer (creating the row if
   * needed) and follow it. Triggers on-follow ingestion as a side effect.
   */
  followAttraction: protectedProcedure
    .input(
      z.object({
        tmAttractionId: z.string().min(1),
        name: z.string().min(1),
        imageUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { performer } = await matchOrCreatePerformer({
        name: input.name,
        tmAttractionId: input.tmAttractionId,
        imageUrl: input.imageUrl,
      });
      await ctx.db
        .insert(userPerformerFollows)
        .values({ userId, performerId: performer.id })
        .onConflictDoNothing();
      void enqueueIngestPerformer(performer.id);
      return { performerId: performer.id };
    }),

  follow: protectedProcedure
    .input(z.object({ performerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .insert(userPerformerFollows)
        .values({ userId, performerId: input.performerId })
        .onConflictDoNothing();

      log.info({ event: 'performer.follow', userId, performerId: input.performerId }, 'Performer followed');

      // Fire-and-forget Phase 3 ingestion for this performer.
      void enqueueIngestPerformer(input.performerId);

      return { success: true };
    }),

  unfollow: protectedProcedure
    .input(z.object({ performerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .delete(userPerformerFollows)
        .where(
          and(
            eq(userPerformerFollows.userId, userId),
            eq(userPerformerFollows.performerId, input.performerId),
          ),
        );

      log.info({ event: 'performer.unfollow', userId, performerId: input.performerId }, 'Performer unfollowed');

      const [stillFollowed] = await ctx.db
        .select({ userId: userPerformerFollows.userId })
        .from(userPerformerFollows)
        .where(eq(userPerformerFollows.performerId, input.performerId))
        .limit(1);

      if (!stillFollowed) {
        const candidateRows = await ctx.db
          .select({
            id: announcements.id,
            venueId: announcements.venueId,
            headlinerPerformerId: announcements.headlinerPerformerId,
            venueLat: venues.latitude,
            venueLng: venues.longitude,
          })
          .from(announcements)
          .innerJoin(venues, eq(announcements.venueId, venues.id))
          .where(eq(announcements.headlinerPerformerId, input.performerId));

        if (candidateRows.length > 0) {
          const followedVenueRows = await ctx.db
            .select({ venueId: userVenueFollows.venueId })
            .from(userVenueFollows);
          const allFollowedVenueIds = followedVenueRows.map((r) => r.venueId);

          const activeRegionRows = await ctx.db
            .select()
            .from(userRegions)
            .where(eq(userRegions.active, true));
          const allActiveRegions = activeRegionRows.map((r) => ({
            latitude: r.latitude,
            longitude: r.longitude,
            radiusMiles: r.radiusMiles,
          }));

          const toDelete = computePerformerAnnouncementsToDelete(
            candidateRows.map((r) => ({
              id: r.id,
              venueId: r.venueId,
              headlinerPerformerId: r.headlinerPerformerId,
              venueLat: r.venueLat,
              venueLng: r.venueLng,
            })),
            allActiveRegions,
            allFollowedVenueIds,
          );

          if (toDelete.length > 0) {
            await ctx.db
              .delete(announcements)
              .where(inArray(announcements.id, toDelete));
          }
        }
      }

      return { success: true };
    }),

  detail: protectedProcedure
    .input(z.object({ performerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const [performer] = await ctx.db
        .select()
        .from(performers)
        .where(eq(performers.id, input.performerId))
        .limit(1);

      if (!performer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Performer not found' });
      }

      const [followRow] = await ctx.db
        .select({ performerId: userPerformerFollows.performerId })
        .from(userPerformerFollows)
        .where(
          and(
            eq(userPerformerFollows.userId, userId),
            eq(userPerformerFollows.performerId, input.performerId),
          ),
        )
        .limit(1);

      const [stats] = await ctx.db
        .select({
          showCount: count(shows.id),
          firstSeen: min(shows.date),
          lastSeen: max(shows.date),
        })
        .from(showPerformers)
        .innerJoin(shows, eq(showPerformers.showId, shows.id))
        .where(
          and(
            eq(showPerformers.performerId, input.performerId),
            eq(shows.userId, userId),
          ),
        );

      return {
        ...performer,
        isFollowed: Boolean(followRow),
        showCount: stats?.showCount ?? 0,
        firstSeen: stats?.firstSeen ?? null,
        lastSeen: stats?.lastSeen ?? null,
      };
    }),

  userShows: protectedProcedure
    .input(z.object({ performerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const showIds = await ctx.db
        .select({ showId: showPerformers.showId })
        .from(showPerformers)
        .innerJoin(shows, eq(showPerformers.showId, shows.id))
        .where(
          and(
            eq(showPerformers.performerId, input.performerId),
            eq(shows.userId, userId),
          ),
        );

      const ids = showIds.map((r) => r.showId);
      if (ids.length === 0) return [];

      return ctx.db.query.shows.findMany({
        where: (s, { inArray }) => inArray(s.id, ids),
        orderBy: [desc(shows.date)],
        with: {
          venue: true,
          showPerformers: {
            with: { performer: true },
          },
        },
      });
    }),

  rename: protectedProcedure
    .input(z.object({ performerId: z.string().uuid(), name: z.string().min(1).max(300) }))
    .mutation(async ({ ctx, input }) => {
      // Performers are a shared global record — anyone can resolve the same
      // artist. Require the caller to actually have a stake (an attended/
      // ticketed show featuring this performer, or a follow) before letting
      // them mutate the canonical name. Otherwise a user could rename any
      // artist for everyone else.
      const userId = ctx.session.user.id;

      const [stake] = await ctx.db
        .select({ id: shows.id })
        .from(shows)
        .innerJoin(showPerformers, eq(showPerformers.showId, shows.id))
        .where(
          and(
            eq(shows.userId, userId),
            eq(showPerformers.performerId, input.performerId),
          ),
        )
        .limit(1);

      if (!stake) {
        const [follow] = await ctx.db
          .select({ performerId: userPerformerFollows.performerId })
          .from(userPerformerFollows)
          .where(
            and(
              eq(userPerformerFollows.userId, userId),
              eq(userPerformerFollows.performerId, input.performerId),
            ),
          )
          .limit(1);
        if (!follow) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You can only rename performers you have shows or follows for',
          });
        }
      }

      const [updated] = await ctx.db
        .update(performers)
        .set({ name: input.name.trim() })
        .where(eq(performers.id, input.performerId))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Performer not found' });
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ performerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Atomic: detach performer from all of the user's shows AND drop the
      // follow in one go. A partial failure would leave the user thinking
      // they unfollowed but the performer still tagged on past shows.
      await ctx.db.transaction(async (tx) => {
        const userShowIds = await tx
          .select({ id: shows.id })
          .from(shows)
          .where(eq(shows.userId, userId));

        if (userShowIds.length > 0) {
          const ids = userShowIds.map((s) => s.id);
          await tx
            .delete(showPerformers)
            .where(
              and(
                eq(showPerformers.performerId, input.performerId),
                inArray(showPerformers.showId, ids),
              ),
            );
        }

        await tx
          .delete(userPerformerFollows)
          .where(
            and(
              eq(userPerformerFollows.userId, userId),
              eq(userPerformerFollows.performerId, input.performerId),
            ),
          );
      });

      return { deleted: 1 };
    }),
});
