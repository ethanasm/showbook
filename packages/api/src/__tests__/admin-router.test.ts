import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { adminRouter } from '../routers/admin';
import { makeFakeDb, fakeCtx, type FakeDb } from './_fake-db';

function caller(db: FakeDb, userId = 'test-user') {
  return adminRouter.createCaller(fakeCtx(db, userId) as never);
}

const ADMIN_EMAIL = 'admin@example.com';
const NON_ADMIN_EMAIL = 'someone-else@example.com';

describe('adminRouter', () => {
  let prevAdminEmails: string | undefined;
  before(() => {
    prevAdminEmails = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  });
  after(() => {
    if (prevAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prevAdminEmails;
  });

  describe('amIAdmin', () => {
    it('returns true for the admin email (case-insensitive)', async () => {
      const db = makeFakeDb({
        // protectedProcedure: select id; then amIAdmin selects email
        selectResults: [[{ email: 'Admin@Example.com' }]],
      });
      const result = await caller(db).amIAdmin();
      assert.deepEqual(result, { isAdmin: true });
    });

    it('returns false for a non-admin email', async () => {
      const db = makeFakeDb({
        selectResults: [[{ email: NON_ADMIN_EMAIL }]],
      });
      const result = await caller(db).amIAdmin();
      assert.deepEqual(result, { isAdmin: false });
    });

    it('returns false when the user has no email', async () => {
      const db = makeFakeDb({
        selectResults: [[{ email: null }]],
      });
      const result = await caller(db).amIAdmin();
      assert.deepEqual(result, { isAdmin: false });
    });

    it('returns false when the user lookup is empty', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).amIAdmin();
      assert.deepEqual(result, { isAdmin: false });
    });
  });

  describe('admin-only mutations', () => {
    it('backfillVenueCoordinates throws FORBIDDEN for a non-admin caller', async () => {
      // adminProcedure does its own SELECT id+email — override authUserId to
      // null so we can script that lookup directly.
      const db = makeFakeDb({
        authUserId: null,
        selectResults: [[{ id: 'test-user', email: NON_ADMIN_EMAIL }]],
      });
      await assert.rejects(
        () => caller(db).backfillVenueCoordinates(),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'FORBIDDEN',
      );
    });

    it('backfillVenueTicketmaster throws FORBIDDEN for a non-admin caller', async () => {
      const db = makeFakeDb({
        authUserId: null,
        selectResults: [[{ id: 'test-user', email: NON_ADMIN_EMAIL }]],
      });
      await assert.rejects(
        () => caller(db).backfillVenueTicketmaster(),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'FORBIDDEN',
      );
    });

    it('backfillVenueCoordinates throws UNAUTHORIZED with no session', async () => {
      const db = makeFakeDb({ authUserId: null });
      const noSessionCaller = adminRouter.createCaller(
        { db, session: null } as never,
      );
      await assert.rejects(
        () => noSessionCaller.backfillVenueCoordinates(),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'UNAUTHORIZED',
      );
    });

    it('backfillVenueCoordinates returns an empty summary when no venues need it (admin caller)', async () => {
      // adminProcedure auth lookup → returns admin email.
      // Then handler queries venues → returns []. No further calls.
      const db = makeFakeDb({
        authUserId: null,
        selectResults: [
          [{ id: 'test-user', email: ADMIN_EMAIL }], // adminProcedure
          [], // venues.select() returns empty list
        ],
      });
      const result = await caller(db).backfillVenueCoordinates();
      assert.deepEqual(result, { total: 0, geocoded: 0, failed: 0 });
    });

    it('backfillVenueTicketmaster returns an empty summary when no venues need it (admin caller)', async () => {
      const db = makeFakeDb({
        authUserId: null,
        selectResults: [
          [{ id: 'test-user', email: ADMIN_EMAIL }],
          [],
        ],
      });
      const result = await caller(db).backfillVenueTicketmaster();
      assert.deepEqual(result, { total: 0, matched: 0, failed: 0 });
    });
  });
});
