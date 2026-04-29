import { z } from 'zod';
import { eq, and, ne, sql, desc, count, max, min, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { performers, userPerformerFollows, shows, showPerformers } from '@showbook/db';
import { enqueueIngestPerformer } from '../job-queue';
import { searchAttractions, selectBestImage } from '../ticketmaster';
import { matchOrCreatePerformer } from '../performer-matcher';

export const performersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const rows = await ctx.db
      .select({
        id: performers.id,
        name: performers.name,
        imageUrl: performers.imageUrl,
        showCount: count(shows.id),
        lastSeen: max(shows.date),
        firstSeen: min(shows.date),
      })
      .from(showPerformers)
      .innerJoin(performers, eq(showPerformers.performerId, performers.id))
      .innerJoin(shows, eq(showPerformers.showId, shows.id))
      .where(and(eq(shows.userId, userId), ne(shows.kind, 'theatre')))
      .groupBy(performers.id, performers.name, performers.imageUrl)
      .orderBy(desc(max(shows.date)));

    const followed = await ctx.db
      .select({ performerId: userPerformerFollows.performerId })
      .from(userPerformerFollows)
      .where(eq(userPerformerFollows.userId, userId));

    const followedSet = new Set(followed.map((f) => f.performerId));
    return rows.map((r) => ({ ...r, isFollowed: followedSet.has(r.id) }));
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
        console.error('[performers.searchExternal] failed:', err);
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

      const userShowIds = await ctx.db
        .select({ id: shows.id })
        .from(shows)
        .where(eq(shows.userId, userId));

      if (userShowIds.length > 0) {
        const ids = userShowIds.map((s) => s.id);
        await ctx.db
          .delete(showPerformers)
          .where(
            and(
              eq(showPerformers.performerId, input.performerId),
              inArray(showPerformers.showId, ids),
            ),
          );
      }

      await ctx.db
        .delete(userPerformerFollows)
        .where(
          and(
            eq(userPerformerFollows.userId, userId),
            eq(userPerformerFollows.performerId, input.performerId),
          ),
        );

      return { deleted: 1 };
    }),
});
