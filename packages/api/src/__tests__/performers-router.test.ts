/**
 * Unit tests for the performers tRPC router. Replaces the integration
 * variant that hung during cleanup against the e2e DB.
 *
 * The router is mostly thin SQL glue; the meaty business rule
 * (`computePerformerAnnouncementsToDelete`) is already exercised by
 * `performer-unfollow-cleanup.test.ts`. What this file covers:
 *   - the early-throw paths (NOT_FOUND, FORBIDDEN, zod-min(1))
 *   - the `searchExternal` swallow-error path
 *   - the rename-trim behaviour
 *
 * `ctx.db` is replaced by a lightweight chainable proxy that returns
 * scripted results for each terminal `select`. We never touch the real
 * postgres pool, so tests are deterministic and fast.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { performersRouter } from '../routers/performers';

type SelectScript = unknown[];

function makeFakeDb(opts: {
  selectResults: SelectScript;
  updateResult?: unknown[];
}) {
  const results = [...opts.selectResults];
  const updateResult = opts.updateResult ?? [];

  // A chainable thenable: every method returns `this`, awaiting yields the
  // next scripted result.
  function chain(getResult: () => unknown) {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === 'then') {
          const value = getResult();
          return (resolve: (v: unknown) => unknown) =>
            Promise.resolve(value).then(resolve);
        }
        return () => proxy;
      },
    };
    const proxy: object = new Proxy({}, handler);
    return proxy;
  }

  return {
    select: () =>
      chain(() => {
        if (results.length === 0) {
          throw new Error('fake db: select called more times than scripted');
        }
        return results.shift();
      }),
    insert: () => chain(() => undefined),
    delete: () => chain(() => undefined),
    update: () => chain(() => updateResult),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      select: () => chain(() => (results.length ? results.shift() : [])),
      delete: () => chain(() => undefined),
      insert: () => chain(() => undefined),
      update: () => chain(() => updateResult),
    }),
    query: {
      shows: { findMany: async () => [] },
    },
    _remaining: () => results.length,
  };
}

function callerWith(db: unknown, userId = 'test-user') {
  return performersRouter.createCaller({
    db: db as never,
    session: { user: { id: userId } },
  } as never);
}

describe('performersRouter (unit)', () => {
  describe('detail', () => {
    it('throws NOT_FOUND when the performer row does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () =>
          callerWith(db).detail({
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
          [performer], // performer lookup
          [{ performerId: performer.id }], // follow row
          [{ showCount: 3, firstSeen: '2020-01-01', lastSeen: '2024-01-01' }],
        ],
      });
      const result = await callerWith(db).detail({
        performerId: performer.id,
      });
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
      const result = await callerWith(db).detail({
        performerId: performer.id,
      });
      assert.equal(result.isFollowed, false);
    });
  });

  describe('search', () => {
    it('rejects empty query (zod min(1))', async () => {
      const db = makeFakeDb({ selectResults: [] });
      await assert.rejects(() => callerWith(db).search({ query: '' }));
    });
  });

  describe('rename', () => {
    it('throws FORBIDDEN when caller has no follow and no show stake', async () => {
      const db = makeFakeDb({
        selectResults: [
          [], // no follow row
          [], // no show stake
        ],
      });
      await assert.rejects(
        () =>
          callerWith(db).rename({
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
        selectResults: [
          [{ performerId }], // follow row exists, skips show check
        ],
        updateResult: [updated],
      });
      const result = await callerWith(db).rename({
        performerId,
        name: '   Trimmed   ',
      });
      assert.equal(result.name, 'Trimmed');
    });

    it('throws NOT_FOUND when update returns nothing', async () => {
      const performerId = '55555555-5555-4555-8555-555555555555';
      const db = makeFakeDb({
        selectResults: [[{ performerId }]],
        updateResult: [],
      });
      await assert.rejects(
        () => callerWith(db).rename({ performerId, name: 'x' }),
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
        const db = makeFakeDb({ selectResults: [] });
        const result = await callerWith(db).searchExternal({
          query: 'unique-test-query',
        });
        assert.deepEqual(result, []);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe('userShows', () => {
    it('returns [] without hydrating when no shows match', async () => {
      const db = makeFakeDb({
        selectResults: [
          [], // showIds query returns nothing
        ],
      });
      const result = await callerWith(db).userShows({
        performerId: '66666666-6666-4666-8666-666666666666',
      });
      assert.deepEqual(result, []);
    });
  });
});
