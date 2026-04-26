import { z } from 'zod';
import { eq, and, ne, sql, desc, count, max, min } from 'drizzle-orm';
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
});
