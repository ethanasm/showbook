import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError, initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { adminProcedure, protectedProcedure, router } from '../trpc';
import { makeFakeDb, fakeCtx } from './_fake-db';

const t = initTRPC.create({ transformer: superjson });

const testRouter = router({
  ping: protectedProcedure.query(({ ctx }) => ctx.session.user.id),
  pingAdmin: adminProcedure.query(({ ctx }) => ctx.session.user.id),
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

describe('adminProcedure auth middleware', () => {
  let prevAdminEmails: string | undefined;
  before(() => {
    prevAdminEmails = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'admin@example.com';
  });
  after(() => {
    if (prevAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prevAdminEmails;
  });

  it('rejects when there is no session', async () => {
    const db = makeFakeDb({ authUserId: null });
    const caller = testRouter.createCaller({ db, session: null } as never);
    await assert.rejects(
      () => caller.pingAdmin(),
      (err: unknown) => err instanceof TRPCError && err.code === 'UNAUTHORIZED',
    );
  });

  it('rejects when the session user does not exist', async () => {
    const db = makeFakeDb({ authUserId: null, selectResults: [[]] });
    const caller = testRouter.createCaller(fakeCtx(db, 'missing-user') as never);
    await assert.rejects(
      () => caller.pingAdmin(),
      (err: unknown) =>
        err instanceof TRPCError &&
        err.code === 'UNAUTHORIZED' &&
        err.message === 'User not found',
    );
  });

  it('rejects with FORBIDDEN when the user is not on ADMIN_EMAILS', async () => {
    const db = makeFakeDb({
      authUserId: null,
      selectResults: [[{ id: 'test-user', email: 'someone-else@example.com' }]],
    });
    const caller = testRouter.createCaller(fakeCtx(db) as never);
    await assert.rejects(
      () => caller.pingAdmin(),
      (err: unknown) => err instanceof TRPCError && err.code === 'FORBIDDEN',
    );
  });

  it('rejects with FORBIDDEN when the user has no email', async () => {
    const db = makeFakeDb({
      authUserId: null,
      selectResults: [[{ id: 'test-user', email: null }]],
    });
    const caller = testRouter.createCaller(fakeCtx(db) as never);
    await assert.rejects(
      () => caller.pingAdmin(),
      (err: unknown) => err instanceof TRPCError && err.code === 'FORBIDDEN',
    );
  });

  it('passes through when the user is on ADMIN_EMAILS (case-insensitive)', async () => {
    const db = makeFakeDb({
      authUserId: null,
      selectResults: [[{ id: 'test-user', email: 'Admin@Example.com' }]],
    });
    const caller = testRouter.createCaller(fakeCtx(db) as never);
    assert.equal(await caller.pingAdmin(), 'test-user');
  });

  it('rejects when ADMIN_EMAILS is empty (closed by default)', async () => {
    const saved = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = '';
    try {
      const db = makeFakeDb({
        authUserId: null,
        selectResults: [[{ id: 'test-user', email: 'admin@example.com' }]],
      });
      const caller = testRouter.createCaller(fakeCtx(db) as never);
      await assert.rejects(
        () => caller.pingAdmin(),
        (err: unknown) => err instanceof TRPCError && err.code === 'FORBIDDEN',
      );
    } finally {
      process.env.ADMIN_EMAILS = saved;
    }
  });
});
