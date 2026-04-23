import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { db, type Database } from '@showbook/db';

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

const enforceAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

export const protectedProcedure = t.procedure.use(enforceAuth);
