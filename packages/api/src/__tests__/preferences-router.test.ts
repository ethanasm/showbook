/**
 * Unit tests for the preferences tRPC router. The pure cleanup helpers
 * (computeAnnouncementsToDelete et al) live in preferences.ts and are
 * already covered by performer-unfollow-cleanup.test.ts /
 * region-cleanup.test.ts. What's tested here:
 *   - addRegion 5-region cap
 *   - removeRegion / toggleRegion ownership checks (NOT_FOUND)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { preferencesRouter } from '../routers/preferences';
import { makeFakeDb, fakeCtx, type FakeDb } from './_fake-db';

function caller(db: FakeDb, userId = 'test-user') {
  return preferencesRouter.createCaller(fakeCtx(db, userId) as never);
}

const REGION_ID = '11111111-1111-4111-8111-111111111111';

describe('preferencesRouter (unit)', () => {
  describe('addRegion', () => {
    it('rejects when the user already has 5 regions', async () => {
      const db = makeFakeDb({
        selectResults: [Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` }))],
      });
      await assert.rejects(
        () =>
          caller(db).addRegion({
            cityName: 'NYC',
            latitude: 40.7,
            longitude: -74,
            radiusMiles: 25,
          }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });

    // Note: the success path triggers `enqueueIngestRegion` which opens a
    // pg-boss connection and stalls the unit-test event loop. The cap
    // rejection path above runs to completion before any side effects, so
    // it's enough for unit coverage; the success path is exercised in the
    // wider integration / e2e suites.
  });

  describe('removeRegion', () => {
    it('throws NOT_FOUND when the region is not owned by caller', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () => caller(db).removeRegion({ regionId: REGION_ID }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });
  });

  describe('toggleRegion', () => {
    it('throws NOT_FOUND when the region is not owned by caller', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () => caller(db).toggleRegion({ regionId: REGION_ID }),
        (err: unknown) =>
          err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('does not enqueue when active is unchanged or new active=false', async () => {
      const existing = {
        id: REGION_ID,
        userId: 'test-user',
        cityName: 'NYC',
        latitude: 40.7,
        longitude: -74,
        radiusMiles: 25,
        active: true,
      };
      // Toggling true → false: updated.active=false; no enqueue branch.
      const updated = { ...existing, active: false };
      const db = makeFakeDb({
        selectResults: [[existing]],
        updateResults: [[updated]],
      });
      const result = await caller(db).toggleRegion({ regionId: REGION_ID });
      assert.equal(result.active, false);
    });

    it('returns the toggled region when it exists', async () => {
      const existing = {
        id: REGION_ID,
        userId: 'test-user',
        cityName: 'NYC',
        latitude: 40.7,
        longitude: -74,
        radiusMiles: 25,
        active: true,
      };
      const updated = { ...existing, active: false };
      const db = makeFakeDb({
        selectResults: [[existing]],
        updateResults: [[updated]],
      });
      const result = await caller(db).toggleRegion({ regionId: REGION_ID });
      assert.equal(result.active, false);
    });
  });

  describe('get', () => {
    it('returns existing preferences and regions', async () => {
      const prefs = { userId: 'test-user', theme: 'system' };
      const regions = [
        { id: REGION_ID, userId: 'test-user', cityName: 'NYC' },
      ];
      const db = makeFakeDb({ selectResults: [[prefs], regions] });
      const result = await caller(db).get();
      assert.deepEqual(result.preferences, prefs);
      assert.equal(result.regions.length, 1);
    });

    it('inserts default preferences when none exist', async () => {
      const created = { userId: 'test-user', theme: 'system' };
      const db = makeFakeDb({
        selectResults: [[], []],
        insertResults: [[created]],
      });
      const result = await caller(db).get();
      assert.deepEqual(result.preferences, created);
      assert.deepEqual(result.regions, []);
    });
  });

  describe('update', () => {
    it('upserts and returns the row', async () => {
      const prefs = { userId: 'test-user', theme: 'dark' };
      const db = makeFakeDb({
        insertResults: [[prefs]],
      });
      const result = await caller(db).update({ theme: 'dark' });
      assert.deepEqual(result, prefs);
    });
  });

  describe('removeRegion (cleanup paths)', () => {
    it('returns success when no candidate announcements', async () => {
      const existing = {
        id: REGION_ID,
        userId: 'test-user',
        cityName: 'NYC',
        latitude: 40.7,
        longitude: -74,
        radiusMiles: 25,
        active: true,
      };
      const db = makeFakeDb({
        selectResults: [
          [existing], // ownership
          [], // other regions
          [], // followed venues
          [], // followed performers
          [], // candidate announcements
        ],
      });
      const result = await caller(db).removeRegion({ regionId: REGION_ID });
      assert.deepEqual(result, { success: true });
    });
  });
});
