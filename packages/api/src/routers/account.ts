import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { child } from '@showbook/observability';
import { users } from '@showbook/db';
import { router, protectedProcedure } from '../trpc';

const log = child({ component: 'api.account' });

/**
 * Account router.
 *
 * Today the only surface is `delete()` — GDPR-shaped self-service
 * account erasure. Cascade is owned by the `users` table FK chain
 * (migration 0022 declared ON DELETE CASCADE for every owning
 * relation), so the mutation just drops the user row and trusts
 * Postgres to wipe the dependent rows in one transaction.
 *
 * Sign-out is the caller's responsibility — the tRPC mutation can't
 * mutate cookies on the NextAuth session from this layer. The UI on
 * /preferences calls `signOut({ redirect: false })` immediately
 * after the mutation resolves and routes the browser to /signin.
 */
export const accountRouter = router({
  /**
   * Permanently delete the calling user's account and all owned data
   * (shows, setlists, media metadata, follows, integrations).
   *
   * The `confirmation` input is a literal "DELETE" string that the UI
   * collects via a typed-confirm modal. Validating it here is
   * defence-in-depth — a misclick from a future automation can't
   * trigger a delete just by hitting the endpoint with no payload.
   */
  delete: protectedProcedure
    .input(
      z.object({
        confirmation: z.literal('DELETE'),
      }),
    )
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;

      // Best-effort existence check so the audit log can distinguish
      // a real delete from a no-op against a stale session.
      const existing = await ctx.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Account no longer exists',
        });
      }

      // Cascade is owned by the FK chain — see migration 0022.
      const result = await ctx.db
        .delete(users)
        .where(eq(users.id, userId))
        .returning({ id: users.id });

      if (result.length === 0) {
        // Treat a missed delete as the same shape as "already gone"
        // so the client UX collapses both paths into one toast.
        log.warn(
          { event: 'account.delete.no_op', userId },
          'Delete returned zero rows — race with another delete?',
        );
        return { deleted: false } as const;
      }

      log.info(
        {
          event: 'auth.user_deleted',
          userId,
          email: existing[0].email,
        },
        'User account deleted',
      );

      return { deleted: true } as const;
    }),
});
