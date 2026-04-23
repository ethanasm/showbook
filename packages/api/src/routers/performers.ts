import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc';
import { performers, userPerformerFollows } from '@showbook/db';

export const performersRouter = router({
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
