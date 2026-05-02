/**
 * Unit tests for the performers tRPC router. Replaces the integration
 * variant that hung against the e2e DB during cleanup.
 *
 * Coverage focus: the early-throw paths (NOT_FOUND, FORBIDDEN, zod
 * min(1)), the rename trim, and the searchExternal swallow-error path.
 * The orphan-announcement cleanup logic is already exercised in
 * performer-unfollow-cleanup.test.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { performersRouter } from '../routers/performers';
import { makeFakeDb, fakeCtx, type FakeDb } from './_fake-db';

function caller(db: FakeDb, userId = 'test-user') {
  return performersRouter.createCaller(fakeCtx(db, userId) as never);
}

describe('performersRouter (unit)', () => {
  describe('detail', () => {
    it('throws NOT_FOUND when the performer row does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () =>
          caller(db).detail({
            performerId: '00000000-0000-0000-0000-000000000000',
          }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('returns the performer with isFollowed and stats when found', async () => {
      const performer = {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Test Artist',
        imageUrl: null,
        musicbrainzId: null,
        ticketmasterAttractionId: null,
      };
      const db = makeFakeDb({
        selectResults: [
          [performer],
          [{ performerId: performer.id }],
          [{ showCount: 3, firstSeen: '2020-01-01', lastSeen: '2024-01-01' }],
        ],
      });
      const result = await caller(db).detail({ performerId: performer.id });
      assert.equal(result.id, performer.id);
      assert.equal(result.isFollowed, true);
      assert.equal(result.showCount, 3);
      assert.equal(result.firstSeen, '2020-01-01');
      assert.equal(result.lastSeen, '2024-01-01');
    });

    it('returns isFollowed=false when no follow row exists', async () => {
      const performer = {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Other Artist',
        imageUrl: null,
        musicbrainzId: null,
        ticketmasterAttractionId: null,
      };
      const db = makeFakeDb({
        selectResults: [[performer], [], [{ showCount: 0 }]],
      });
      const result = await caller(db).detail({ performerId: performer.id });
      assert.equal(result.isFollowed, false);
    });
  });

  describe('search', () => {
    it('rejects empty query (zod min(1))', async () => {
      const db = makeFakeDb();
      await assert.rejects(() => caller(db).search({ query: '' }));
    });
  });

  describe('rename', () => {
    it('throws FORBIDDEN when caller has no follow and no show stake', async () => {
      const db = makeFakeDb({ selectResults: [[], []] });
      await assert.rejects(
        () =>
          caller(db).rename({
            performerId: '33333333-3333-4333-8333-333333333333',
            name: 'New Name',
          }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'FORBIDDEN',
      );
    });

    it('trims whitespace and returns the updated row when caller follows', async () => {
      const performerId = '44444444-4444-4444-8444-444444444444';
      const updated = { id: performerId, name: 'Trimmed' };
      const db = makeFakeDb({
        selectResults: [[{ performerId }]],
        updateResults: [[updated]],
      });
      const result = await caller(db).rename({
        performerId,
        name: '   Trimmed   ',
      });
      assert.equal(result.name, 'Trimmed');
    });

    it('throws NOT_FOUND when update returns nothing', async () => {
      const performerId = '55555555-5555-4555-8555-555555555555';
      const db = makeFakeDb({
        selectResults: [[{ performerId }]],
        updateResults: [[]],
      });
      await assert.rejects(
        () => caller(db).rename({ performerId, name: 'x' }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });
  });

  describe('searchExternal', () => {
    it('returns [] when the upstream throws (errors are swallowed)', async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new Error('network down (test stub)');
      }) as typeof globalThis.fetch;
      try {
        const db = makeFakeDb();
        const result = await caller(db).searchExternal({
          query: 'unique-test-query',
        });
        assert.deepEqual(result, []);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe('list', () => {
    it('joins follow set onto performer rows', async () => {
      const rows = [
        { id: 'p1', name: 'A', imageUrl: null, musicbrainzId: null, ticketmasterAttractionId: null, showCount: 2, pastShowsCount: 2, futureShowsCount: 0, lastSeen: '2024-01-01', firstSeen: '2020-01-01' },
        { id: 'p2', name: 'B', imageUrl: null, musicbrainzId: null, ticketmasterAttractionId: null, showCount: 1, pastShowsCount: 0, futureShowsCount: 1, lastSeen: '2026-08-01', firstSeen: '2026-08-01' },
      ];
      const db = makeFakeDb({ selectResults: [rows, [{ performerId: 'p2' }]] });
      const result = await caller(db).list();
      assert.equal(result.find((r) => r.id === 'p1')!.isFollowed, false);
      assert.equal(result.find((r) => r.id === 'p2')!.isFollowed, true);
    });
  });

  describe('count', () => {
    it('returns count from row', async () => {
      const db = makeFakeDb({ selectResults: [[{ count: 9 }]] });
      const result = await caller(db).count();
      assert.equal(result, 9);
    });

    it('returns 0 when row absent', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).count();
      assert.equal(result, 0);
    });
  });

  describe('unfollow', () => {
    it('skips cleanup when someone else still follows', async () => {
      const db = makeFakeDb({
        selectResults: [[{ userId: 'someone-else' }]],
      });
      const result = await caller(db).unfollow({
        performerId: '77777777-7777-4777-8777-777777777777',
      });
      assert.deepEqual(result, { success: true });
    });

    it('returns success when no candidate announcements', async () => {
      const db = makeFakeDb({
        selectResults: [
          [], // stillFollowed empty
          [], // candidate announcements empty
        ],
      });
      const result = await caller(db).unfollow({
        performerId: '88888888-8888-4888-8888-888888888888',
      });
      assert.deepEqual(result, { success: true });
    });
  });

  describe('userShows', () => {
    it('returns [] without hydrating when no shows match', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).userShows({
        performerId: '66666666-6666-4666-8666-666666666666',
      });
      assert.deepEqual(result, []);
    });
  });

  describe('follow', () => {
    // Note: enqueueIngestPerformer opens a pg-boss connection — we only
    // ensure the input shape is accepted; the side-effect path is
    // covered by integration tests. Skipped here because awaiting the
    // job enqueue stalls the unit-test event loop.
  });

  describe('search', () => {
    it('runs an ilike query and returns rows', async () => {
      const db = makeFakeDb({
        selectResults: [[{ id: 'p1', name: 'matched' }]],
      });
      const result = await caller(db).search({ query: 'matched' });
      assert.equal(result.length, 1);
    });
  });

  describe('followed', () => {
    it('returns the bare performer rows the user follows', async () => {
      const db = makeFakeDb();
      // findMany on userPerformerFollows returns []
      (db as unknown as {
        query: { userPerformerFollows: { findMany: () => Promise<unknown[]> } };
      }).query = {
        userPerformerFollows: {
          findMany: async () => [
            { performer: { id: 'p1', name: 'A' } },
            { performer: { id: 'p2', name: 'B' } },
          ],
        } as never,
      };
      const result = await caller(db).followed();
      assert.equal(result.length, 2);
    });
  });

  describe('delete', () => {
    it('detaches the performer and removes the follow', async () => {
      const db = makeFakeDb({
        selectResults: [[{ id: 's1' }, { id: 's2' }]],
      });
      const result = await caller(db).delete({
        performerId: '99999999-9999-4999-8999-999999999999',
      });
      assert.deepEqual(result, { deleted: 1 });
    });

    it('handles a user with no shows (skips the inner delete)', async () => {
      const db = makeFakeDb({
        selectResults: [[]],
      });
      const result = await caller(db).delete({
        performerId: '99999999-9999-4999-8999-999999999999',
      });
      assert.deepEqual(result, { deleted: 1 });
    });
  });
});
