/**
 * Unit tests for the media tRPC router. Heavy paths (R2 presign, head,
 * variant DTO mapping) live in media.integration.test.ts; here we cover
 * the cheap rejection branches: storage-disabled, NOT_FOUND, future-show,
 * unsupported mime type, oversize source/stored bytes, quota exceeded,
 * empty performer/venue lists, completeUpload state transitions.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { mediaRouter } from '../routers/media';
import { makeFakeDb, fakeCtx, type FakeDb } from './_fake-db';

function caller(db: FakeDb, userId = 'test-user') {
  return mediaRouter.createCaller(fakeCtx(db, userId) as never);
}

const SHOW_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
const PERFORMER_ID = '33333333-3333-4333-8333-333333333333';

const SAVED_ENV: Record<string, string | undefined> = {};
function snapshotEnv(...keys: string[]) {
  for (const k of keys) SAVED_ENV[k] = process.env[k];
}
function restoreEnv() {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('mediaRouter (unit)', () => {
  before(() => {
    snapshotEnv('MEDIA_STORAGE_MODE');
  });
  after(() => {
    restoreEnv();
  });

  describe('createUploadIntent', () => {
    it('rejects when MEDIA_STORAGE_MODE=disabled', async () => {
      process.env.MEDIA_STORAGE_MODE = 'disabled';
      const db = makeFakeDb();
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'photo',
            mimeType: 'image/jpeg',
            sourceBytes: 1000,
            storedBytes: 1000,
            variants: [{ name: 'orig', mimeType: 'image/jpeg', bytes: 1000 }],
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
      delete process.env.MEDIA_STORAGE_MODE;
    });

    it('throws NOT_FOUND when show does not belong to user', async () => {
      process.env.MEDIA_STORAGE_MODE = 'r2';
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'photo',
            mimeType: 'image/jpeg',
            sourceBytes: 1000,
            storedBytes: 1000,
            variants: [{ name: 'orig', mimeType: 'image/jpeg', bytes: 1000 }],
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('rejects when show is in the future (not past)', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
        .toISOString()
        .slice(0, 10);
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, date: futureDate, endDate: null }],
        ],
      });
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'photo',
            mimeType: 'image/jpeg',
            sourceBytes: 1000,
            storedBytes: 1000,
            variants: [{ name: 'orig', mimeType: 'image/jpeg', bytes: 1000 }],
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });

    it('rejects when show has no date', async () => {
      const db = makeFakeDb({
        selectResults: [[{ id: SHOW_ID, date: null, endDate: null }]],
      });
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'photo',
            mimeType: 'image/jpeg',
            sourceBytes: 1000,
            storedBytes: 1000,
            variants: [{ name: 'orig', mimeType: 'image/jpeg', bytes: 1000 }],
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });

    it('rejects unsupported photo mime type', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, date: '2020-01-01', endDate: null }],
        ],
      });
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'photo',
            mimeType: 'image/gif',
            sourceBytes: 1000,
            storedBytes: 1000,
            variants: [{ name: 'orig', mimeType: 'image/gif', bytes: 1000 }],
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });

    it('rejects unsupported video mime type', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, date: '2020-01-01', endDate: null }],
        ],
      });
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'video',
            mimeType: 'video/quicktime',
            sourceBytes: 1000,
            storedBytes: 1000,
            variants: [{ name: 'source', mimeType: 'video/quicktime', bytes: 1000 }],
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });

    it('rejects oversize photo source', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, date: '2020-01-01', endDate: null }],
        ],
      });
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'photo',
            mimeType: 'image/jpeg',
            sourceBytes: 50 * 1024 * 1024,
            storedBytes: 1000,
            variants: [{ name: 'orig', mimeType: 'image/jpeg', bytes: 1000 }],
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });

    it('rejects oversize photo stored', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, date: '2020-01-01', endDate: null }],
        ],
      });
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'photo',
            mimeType: 'image/jpeg',
            sourceBytes: 1000,
            storedBytes: 50 * 1024 * 1024,
            variants: [{ name: 'orig', mimeType: 'image/jpeg', bytes: 1000 }],
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });

    it('rejects oversize video', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, date: '2020-01-01', endDate: null }],
        ],
      });
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'video',
            mimeType: 'video/mp4',
            sourceBytes: 1000,
            storedBytes: 500 * 1024 * 1024,
            variants: [{ name: 'source', mimeType: 'video/mp4', bytes: 500 * 1024 * 1024 }],
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });

    it('rejects when global quota would be exceeded', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, date: '2020-01-01', endDate: null }],
          // Promise.all of three sumBytes — globalUsed huge
          [{ total: 9_000_000_000 }],
          [{ total: 0 }],
          [{ total: 0 }],
        ],
      });
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'photo',
            mimeType: 'image/jpeg',
            sourceBytes: 1000,
            storedBytes: 1000,
            variants: [{ name: 'orig', mimeType: 'image/jpeg', bytes: 1000 }],
          }),
        (err: unknown) =>
          err instanceof TRPCError &&
          err.code === 'BAD_REQUEST' &&
          /Showbook media storage is full/.test(err.message),
      );
    });

    it('rejects when user quota would be exceeded', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, date: '2020-01-01', endDate: null }],
          [{ total: 0 }],
          [{ total: 2_000_000_000 }],
          [{ total: 0 }],
        ],
      });
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'photo',
            mimeType: 'image/jpeg',
            sourceBytes: 1000,
            storedBytes: 1000,
            variants: [{ name: 'orig', mimeType: 'image/jpeg', bytes: 1000 }],
          }),
        (err: unknown) =>
          err instanceof TRPCError && /Your media storage is full/.test(err.message),
      );
    });

    it('rejects when show photo count is at the cap', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, date: '2020-01-01', endDate: null }],
          [{ total: 0 }],
          [{ total: 0 }],
          [{ total: 0 }],
          // groupBy counts query
          [{ mediaType: 'photo', count: 30 }],
        ],
      });
      await assert.rejects(
        () =>
          caller(db).createUploadIntent({
            showId: SHOW_ID,
            mediaType: 'photo',
            mimeType: 'image/jpeg',
            sourceBytes: 1000,
            storedBytes: 1000,
            variants: [{ name: 'orig', mimeType: 'image/jpeg', bytes: 1000 }],
          }),
        (err: unknown) =>
          err instanceof TRPCError && /photo limit/.test(err.message),
      );
    });
  });

  describe('completeUpload', () => {
    it('throws NOT_FOUND when asset does not exist', async () => {
      const db = makeFakeDb();
      (db as unknown as { query: { mediaAssets: { findFirst: () => Promise<unknown> } } }).query = {
        mediaAssets: { findFirst: async () => null } as never,
      };
      await assert.rejects(
        () => caller(db).completeUpload({ assetId: ASSET_ID }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('rejects when asset is in failed state', async () => {
      const db = makeFakeDb();
      (db as unknown as { query: { mediaAssets: { findFirst: () => Promise<unknown> } } }).query = {
        mediaAssets: {
          findFirst: async () => ({
            id: ASSET_ID,
            status: 'failed',
            variants: {},
          }),
        } as never,
      };
      await assert.rejects(
        () => caller(db).completeUpload({ assetId: ASSET_ID }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    });
  });

  describe('listForVenue', () => {
    it('returns [] when user has no shows at the venue', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).listForVenue({
        venueId: '44444444-4444-4444-8444-444444444444',
      });
      assert.deepEqual(result, []);
    });
  });

  describe('listForPerformer', () => {
    it('returns [] when no assets tag the performer', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      const result = await caller(db).listForPerformer({
        performerId: PERFORMER_ID,
      });
      assert.deepEqual(result, []);
    });
  });

  describe('setPerformers', () => {
    it('throws NOT_FOUND when asset row is not owned by user', async () => {
      const db = makeFakeDb({ selectResults: [[]] });
      await assert.rejects(
        () =>
          caller(db).setPerformers({
            assetId: ASSET_ID,
            performerIds: [],
          }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });

    it('clears all performer tags when input is empty', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ assetId: ASSET_ID, showId: SHOW_ID }],
        ],
      });
      const result = await caller(db).setPerformers({
        assetId: ASSET_ID,
        performerIds: [],
      });
      assert.deepEqual(result, { performerIds: [] });
    });
  });

  describe('delete', () => {
    it('throws NOT_FOUND when asset does not exist', async () => {
      const db = makeFakeDb();
      (db as unknown as { query: { mediaAssets: { findFirst: () => Promise<unknown> } } }).query = {
        mediaAssets: { findFirst: async () => null } as never,
      };
      await assert.rejects(
        () => caller(db).delete({ assetId: ASSET_ID }),
        (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
      );
    });
  });
});
