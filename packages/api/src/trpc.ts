import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { eq } from 'drizzle-orm';
import { db, users, type Database } from '@showbook/db';
import { isAdminEmail } from './admin';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface Session {
  user: { id: string };
}

export interface CreateContextOptions {
  session: Session | null;
}

export function createContext(opts: CreateContextOptions) {
  return {
    db,
    session: opts.session,
  };
}

export type Context = ReturnType<typeof createContext>;

// ---------------------------------------------------------------------------
// tRPC init
// ---------------------------------------------------------------------------

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

const enforceAuth = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  const [user] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ctx.session.user.id))
    .limit(1);
  if (!user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User not found' });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

export const protectedProcedure = t.procedure.use(enforceAuth);

// Admin gate. Independent of `enforceAuth` so the intent is obvious at the
// call site. Re-derives admin status from the DB on every call (rather than
// trusting `session.user.email`), so a deleted/renamed/disabled user can't
// keep admin via a stale cookie.
const enforceAdmin = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  const [user] = await ctx.db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, ctx.session.user.id))
    .limit(1);
  if (!user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User not found' });
  }
  if (!isAdminEmail(user.email)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
  }
  return next({
    ctx: {
      ...ctx,
      session: { user: { id: user.id } },
    },
  });
});

export const adminProcedure = t.procedure.use(enforceAdmin);
