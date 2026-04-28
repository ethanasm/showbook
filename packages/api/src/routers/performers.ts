import { z } from 'zod';
import { eq, and, ne, sql, desc, count, max, min } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { performers, userPerformerFollows, shows, showPerformers } from '@showbook/db';

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

    return rows;
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

  follow: protectedProcedure
    .input(z.object({ performerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .insert(userPerformerFollows)
        .values({ userId, performerId: input.performerId })
        .onConflictDoNothing();

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
});
