import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError, initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { protectedProcedure, router } from '../trpc';
import { makeFakeDb, fakeCtx } from './_fake-db';

const t = initTRPC.create({ transformer: superjson });

const testRouter = router({
  ping: protectedProcedure.query(({ ctx }) => ctx.session.user.id),
});

describe('protectedProcedure auth middleware', () => {
  it('rejects when there is no session', async () => {
    const db = makeFakeDb({ authUserId: null });
    const caller = testRouter.createCaller({ db, session: null } as never);
    await assert.rejects(
      () => caller.ping(),
      (err: unknown) => err instanceof TRPCError && err.code === 'UNAUTHORIZED',
    );
  });

  it('rejects when the session user does not exist in the users table', async () => {
    const db = makeFakeDb({ authUserId: null, selectResults: [[]] });
    const caller = testRouter.createCaller(fakeCtx(db, 'missing-user') as never);
    await assert.rejects(
      () => caller.ping(),
      (err: unknown) =>
        err instanceof TRPCError &&
        err.code === 'UNAUTHORIZED' &&
        err.message === 'User not found',
    );
  });

  it('passes through when the user exists', async () => {
    const db = makeFakeDb();
    const caller = testRouter.createCaller(fakeCtx(db) as never);
    assert.equal(await caller.ping(), 'test-user');
  });
});
