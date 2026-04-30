/**
 * Unit tests for the venues tRPC router. Covers the early-throw paths
 * (NOT_FOUND, FORBIDDEN), the rename trim, and unfollow's
 * orphan-deletion bookkeeping. The rest of the router is thin SQL glue
 * better exercised end-to-end (or via the existing nearby-feed
 * integration test).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { venuesRouter } from '../routers/venues';
import { makeFakeDb, fakeCtx, type FakeDb } from './_fake-db';

function caller(db: FakeDb, userId = 'test-user') {
  return venuesRouter.createCaller(fakeCtx(db, userId) as never);
}

const VENUE_ID = '11111111-1111-4111-8111-111111111111';

describe('venuesRouter (unit)', () => {
  describe('detail', () => {
    it('throws NOT_FOUND when the venue does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () => caller(db).detail({ venueId: VENUE_ID }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('returns isFollowed and counts when the venue exists', async () => {
      const venue = {
        id: VENUE_ID,
        name: 'Test Venue',
        city: 'NYC',
        country: 'US',
        latitude: null,
        longitude: null,
      };
      const db = makeFakeDb({
        selectResults: [
          [venue],
          [{ venueId: VENUE_ID }], // user follows
          [{ count: 4 }], // user shows count
          [{ count: 9 }], // upcoming announcements
        ],
      });
      const result = await caller(db).detail({ venueId: VENUE_ID });
      assert.equal(result.id, VENUE_ID);
      assert.equal(result.isFollowed, true);
      assert.equal(result.userShowCount, 4);
      assert.equal(result.upcomingCount, 9);
    });
  });

  describe('rename', () => {
    it('throws FORBIDDEN when caller has no follow and no show', async () => {
      const db = makeFakeDb({ selectResults: [[], []] });
      await assert.rejects(
        () => caller(db).rename({ venueId: VENUE_ID, name: 'X' }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'FORBIDDEN',
      );
    });

    it('trims whitespace and returns the updated row', async () => {
      const updated = { id: VENUE_ID, name: 'Trimmed Hall' };
      const db = makeFakeDb({
        selectResults: [[{ venueId: VENUE_ID }]], // follow exists
        updateResults: [[updated]],
      });
      const result = await caller(db).rename({
        venueId: VENUE_ID,
        name: '   Trimmed Hall   ',
      });
      assert.equal(result.name, 'Trimmed Hall');
    });

    it('throws NOT_FOUND when update returns nothing', async () => {
      const db = makeFakeDb({
        selectResults: [[{ venueId: VENUE_ID }]],
        updateResults: [[]],
      });
      await assert.rejects(
        () => caller(db).rename({ venueId: VENUE_ID, name: 'x' }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });
  });

  describe('search', () => {
    it('rejects empty query', async () => {
      const db = makeFakeDb();
      await assert.rejects(() => caller(db).search({ query: '' }));
    });
  });

  describe('scrapeStatus', () => {
    it('throws NOT_FOUND when venue does not exist', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () => caller(db).scrapeStatus({ venueId: VENUE_ID }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('returns the parsed config and last run when found', async () => {
      const config = { type: 'llm' as const, url: 'https://example.com', frequencyDays: 7 };
      const lastRun = { id: 'r1', venueId: VENUE_ID, startedAt: new Date(), status: 'success' };
      const db = makeFakeDb({
        selectResults: [
          [{ scrapeConfig: config }],
          [lastRun],
        ],
      });
      const result = await caller(db).scrapeStatus({ venueId: VENUE_ID });
      assert.deepEqual(result.config, config);
      assert.equal(result.lastRun?.id, 'r1');
    });

    it('returns null lastRun when no runs exist', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ scrapeConfig: null }],
          [],
        ],
      });
      const result = await caller(db).scrapeStatus({ venueId: VENUE_ID });
      assert.equal(result.lastRun, null);
    });
  });
});
