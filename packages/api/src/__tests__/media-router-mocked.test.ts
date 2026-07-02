/**
 * Unit tests for the media tRPC router with media-storage mocked. Lets
 * us drive the happy paths of getQuota, listForShow, listForVenue,
 * listForPerformer, completeUpload (ready / oversize-cleanup /
 * head-failure branches), delete (including per-variant R2 failures),
 * setPerformers without S3 / R2 access. The observability child logger
 * is also mocked so tests can assert on the structured events the
 * router emits (`media.complete.*`, `media.delete.*`).
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

interface LogCall {
  level: 'info' | 'warn' | 'error';
  payload: Record<string, unknown> & { event?: string };
}
const LOG_CALLS: LogCall[] = [];
function logged(event: string): LogCall | undefined {
  return LOG_CALLS.find((c) => c.payload.event === event);
}

mock.module('@showbook/observability', {
  namedExports: {
    child: () => ({
      info: (payload: LogCall['payload']) => LOG_CALLS.push({ level: 'info', payload }),
      warn: (payload: LogCall['payload']) => LOG_CALLS.push({ level: 'warn', payload }),
      error: (payload: LogCall['payload']) => LOG_CALLS.push({ level: 'error', payload }),
      debug: () => undefined,
    }),
  },
});

// Mutable per-test storage behaviours. Defaults match the original static
// mocks; individual tests swap them to drive failure branches.
let headMediaObjectImpl: (key: string) => Promise<{ bytes: number; contentType: string | null }> =
  async () => ({ bytes: 1000, contentType: 'image/webp' });
let deleteMediaObjectImpl: (key: string) => Promise<void> = async () => undefined;

mock.module('../media-storage.js', {
  namedExports: {
    getMediaUploadUrl: async (key: string) => `https://upload.example/${key}`,
    getMediaReadUrl: async (key: string) => `https://read.example/${key}`,
    headMediaObject: (key: string) => headMediaObjectImpl(key),
    deleteMediaObject: (key: string) => deleteMediaObjectImpl(key),
  },
});

let mediaRouter: typeof import('../routers/media').mediaRouter;
let makeFakeDb: typeof import('./_fake-db').makeFakeDb;
let fakeCtx: typeof import('./_fake-db').fakeCtx;

before(async () => {
  ({ mediaRouter } = await import('../routers/media'));
  ({ makeFakeDb, fakeCtx } = await import('./_fake-db'));
});

function caller(db: ReturnType<typeof makeFakeDb>, userId = 'test-user') {
  return mediaRouter.createCaller(fakeCtx(db, userId) as never);
}

const SHOW_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';

describe('mediaRouter (with mocked storage)', () => {
  beforeEach(() => {
    LOG_CALLS.length = 0;
    headMediaObjectImpl = async () => ({ bytes: 1000, contentType: 'image/webp' });
    deleteMediaObjectImpl = async () => undefined;
  });

  describe('getQuota', () => {
    it('returns global+user used without showId scope', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ total: 100 }], // globalUsed
          [{ total: 50 }],  // userUsed
        ],
      });
      const result = await caller(db).getQuota();
      assert.equal(result.used.globalBytes, 100);
      assert.equal(result.used.userBytes, 50);
      assert.equal(result.used.showBytes, 0);
    });

    it('returns showBytes + photo/video counts when scoped to a show', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ total: 100 }],
          [{ total: 50 }],
          [{ id: SHOW_ID, kind: 'concert', date: '2020-01-01', endDate: null }], // ownership
          [{ total: 25 }], // showUsed
          [
            { mediaType: 'photo', count: 4 },
            { mediaType: 'video', count: 1 },
          ],
        ],
      });
      const result = await caller(db).getQuota({ showId: SHOW_ID });
      assert.equal(result.used.showBytes, 25);
      assert.equal(result.used.showPhotos, 4);
      assert.equal(result.used.showVideos, 1);
    });
  });

  describe('createUploadIntent (success)', () => {
    it('returns presigned upload targets when validation passes', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, date: '2020-01-01', endDate: null }], // show
          [{ total: 0 }], // globalUsed
          [{ total: 0 }], // userUsed
          [{ total: 0 }], // showUsed
          [], // photo/video counts
          [{ sortOrder: 0 }], // sort lookup
        ],
      });
      const result = await caller(db).createUploadIntent({
        showId: SHOW_ID,
        mediaType: 'photo',
        mimeType: 'image/jpeg',
        sourceBytes: 1000,
        storedBytes: 1000,
        variants: [{ name: 'orig', mimeType: 'image/jpeg', bytes: 1000 }],
      });
      assert.ok(result.assetId);
      assert.equal(result.targets.length, 1);
      assert.match(result.targets[0]!.uploadUrl, /^https:\/\/upload/);
    });
  });

  describe('completeUpload (oversize cleanup)', () => {
    it('marks asset failed when measured bytes exceed reservation', async () => {
      const db = makeFakeDb();
      (db as unknown as { query: { mediaAssets: { findFirst: () => Promise<unknown> } } }).query = {
        mediaAssets: {
          findFirst: async () => ({
            id: ASSET_ID,
            status: 'pending',
            bytes: 100, // reserved
            variants: { orig: { key: 'k', mimeType: 'image/webp', bytes: 100 } },
          }),
        } as never,
      };
      // headMediaObject mock returns bytes=1000 — exceeds reservation 100.
      await assert.rejects(() => caller(db).completeUpload({ assetId: ASSET_ID }));
      const failed = logged('media.complete.failed');
      assert.ok(failed, 'expected media.complete.failed event');
      assert.equal(failed.level, 'warn');
      assert.equal(failed.payload.assetId, ASSET_ID);
      assert.equal(failed.payload.reason, 'oversize');
      assert.equal(failed.payload.bytes, 1000);
      assert.equal(failed.payload.reservedBytes, 100);
      // No success event on the failure path.
      assert.equal(logged('media.complete.ready'), undefined);
    });

    it('logs cleanup_failed per variant when oversize R2 cleanup rejects', async () => {
      const db = makeFakeDb();
      (db as unknown as { query: { mediaAssets: { findFirst: () => Promise<unknown> } } }).query = {
        mediaAssets: {
          findFirst: async () => ({
            id: ASSET_ID,
            status: 'pending',
            bytes: 100,
            variants: { orig: { key: 'k', mimeType: 'image/webp', bytes: 100 } },
          }),
        } as never,
      };
      deleteMediaObjectImpl = async () => {
        throw new Error('r2 down');
      };
      await assert.rejects(() => caller(db).completeUpload({ assetId: ASSET_ID }));
      const cleanup = logged('media.complete.cleanup_failed');
      assert.ok(cleanup, 'expected media.complete.cleanup_failed event');
      assert.equal(cleanup.level, 'warn');
      assert.equal(cleanup.payload.assetId, ASSET_ID);
    });

    it('logs head_failed with asset context and rethrows when R2 HEAD fails', async () => {
      const db = makeFakeDb();
      (db as unknown as { query: { mediaAssets: { findFirst: () => Promise<unknown> } } }).query = {
        mediaAssets: {
          findFirst: async () => ({
            id: ASSET_ID,
            status: 'pending',
            bytes: 100,
            variants: { orig: { key: 'k', mimeType: 'image/webp', bytes: 100 } },
          }),
        } as never,
      };
      headMediaObjectImpl = async () => {
        throw new Error('HEAD 503');
      };
      await assert.rejects(
        () => caller(db).completeUpload({ assetId: ASSET_ID }),
        /HEAD 503/,
      );
      const headFailed = logged('media.complete.head_failed');
      assert.ok(headFailed, 'expected media.complete.head_failed event');
      assert.equal(headFailed.level, 'error');
      assert.equal(headFailed.payload.assetId, ASSET_ID);
      assert.equal(headFailed.payload.variant, 'orig');
      assert.ok(headFailed.payload.err instanceof Error);
      // The asset must NOT be marked failed on a transient HEAD error.
      assert.equal(logged('media.complete.failed'), undefined);
    });

    it('logs media.complete.ready when the asset transitions to ready', async () => {
      const updatedRow = {
        id: ASSET_ID,
        showId: SHOW_ID,
        userId: 'test-user',
        mediaType: 'photo',
        status: 'ready',
        mimeType: 'image/webp',
        bytes: 1000,
        width: null,
        height: null,
        durationMs: null,
        caption: null,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: { orig: { key: 'k', mimeType: 'image/webp', bytes: 1000 } },
      };
      const db = makeFakeDb({ updateResults: [[updatedRow]] });
      (db as unknown as { query: { mediaAssets: { findFirst: () => Promise<unknown> } } }).query = {
        mediaAssets: {
          findFirst: async () => ({
            id: ASSET_ID,
            status: 'pending',
            bytes: 2000, // reserved — head returns 1000, within budget
            variants: { orig: { key: 'k', mimeType: 'image/webp', bytes: 2000 } },
            show: null,
            mediaAssetPerformers: [],
          }),
        } as never,
      };
      const result = await caller(db).completeUpload({ assetId: ASSET_ID });
      assert.equal(result.status, 'ready');
      const ready = logged('media.complete.ready');
      assert.ok(ready, 'expected media.complete.ready event');
      assert.equal(ready.level, 'info');
      assert.equal(ready.payload.assetId, ASSET_ID);
      assert.equal(ready.payload.userId, 'test-user');
      assert.equal(ready.payload.variantCount, 1);
      assert.equal(ready.payload.bytes, 1000);
    });

    it('returns the existing dto when asset is already ready', async () => {
      const db = makeFakeDb();
      const asset = {
        id: ASSET_ID,
        showId: SHOW_ID,
        userId: 'test-user',
        mediaType: 'photo',
        status: 'ready',
        mimeType: 'image/webp',
        bytes: 100,
        width: null,
        height: null,
        durationMs: null,
        caption: null,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: { orig: { key: 'k', mimeType: 'image/webp', bytes: 100, width: null, height: null } },
        show: null,
        mediaAssetPerformers: [],
      };
      (db as unknown as { query: { mediaAssets: { findFirst: () => Promise<unknown> } } }).query = {
        mediaAssets: { findFirst: async () => asset } as never,
      };
      const result = await caller(db).completeUpload({ assetId: ASSET_ID });
      assert.equal(result.id, ASSET_ID);
    });
  });

  describe('listForVenue', () => {
    it('returns dtos when shows match', async () => {
      const db = makeFakeDb({
        selectResults: [[{ id: 's1' }, { id: 's2' }]],
      });
      (db as unknown as { query: { mediaAssets: { findMany: () => Promise<unknown[]> } } }).query = {
        mediaAssets: { findMany: async () => [] } as never,
      };
      const result = await caller(db).listForVenue({
        venueId: '11111111-1111-4111-8111-111111111111',
      });
      assert.deepEqual(result, []);
    });
  });

  describe('listForPerformer', () => {
    it('returns dtos when performer assets exist', async () => {
      const db = makeFakeDb({
        selectResults: [[{ assetId: 'a1' }]],
      });
      (db as unknown as { query: { mediaAssets: { findMany: () => Promise<unknown[]> } } }).query = {
        mediaAssets: { findMany: async () => [] } as never,
      };
      const result = await caller(db).listForPerformer({
        performerId: '11111111-1111-4111-8111-111111111111',
      });
      assert.deepEqual(result, []);
    });
  });

  describe('setPerformers (success path)', () => {
    it('replaces tags with validated performer ids', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ assetId: ASSET_ID, showId: SHOW_ID }], // ownership
          [{ id: 'p1' }, { id: 'p2' }], // existing performers (validation)
          [], // existingShowPerformers
          [{ maxOrder: 3 }], // sort lookup
        ],
      });
      const result = await caller(db).setPerformers({
        assetId: ASSET_ID,
        performerIds: [
          '11111111-1111-4111-8111-111111111111', // p1 stand-in
          '22222222-2222-4222-8222-222222222222', // p2 stand-in
        ],
      });
      // Note: the validation step only keeps ids that match the existing
      // performers query, but the fake-db ignores the `where` clause and
      // returns whatever we scripted. The procedure dedupes by Set.
      assert.ok(Array.isArray(result.performerIds));
    });
  });

  describe('listForShow', () => {
    it('returns dtos for ready assets', async () => {
      const db = makeFakeDb({
        selectResults: [
          [{ id: SHOW_ID, kind: 'concert', date: '2020-01-01', endDate: null }], // ownership
        ],
      });
      (db as unknown as { query: { mediaAssets: { findMany: () => Promise<unknown[]> } } }).query = {
        mediaAssets: { findMany: async () => [] } as never,
      };
      const result = await caller(db).listForShow({ showId: SHOW_ID });
      assert.deepEqual(result, []);
    });
  });

  describe('delete', () => {
    it('deletes the storage objects and the row', async () => {
      const db = makeFakeDb();
      (db as unknown as { query: { mediaAssets: { findFirst: () => Promise<unknown> } } }).query = {
        mediaAssets: {
          findFirst: async () => ({
            id: ASSET_ID,
            variants: { orig: { key: 'k1' } },
          }),
        } as never,
      };
      const result = await caller(db).delete({ assetId: ASSET_ID });
      assert.deepEqual(result, { success: true });
      const done = logged('media.delete.done');
      assert.ok(done, 'expected media.delete.done event');
      assert.equal(done.level, 'info');
      assert.equal(done.payload.assetId, ASSET_ID);
      assert.equal(done.payload.userId, 'test-user');
      assert.equal(done.payload.variantsDeleted, 1);
      assert.equal(done.payload.variantsFailed, 0);
    });

    it('still deletes the DB row when a variant blob delete rejects', async () => {
      const db = makeFakeDb();
      let rowDeleted = false;
      const originalDelete = db.delete.bind(db);
      db.delete = () => {
        rowDeleted = true;
        return originalDelete();
      };
      (db as unknown as { query: { mediaAssets: { findFirst: () => Promise<unknown> } } }).query = {
        mediaAssets: {
          findFirst: async () => ({
            id: ASSET_ID,
            variants: {
              orig: { key: 'k-ok' },
              thumb: { key: 'k-broken' },
            },
          }),
        } as never,
      };
      deleteMediaObjectImpl = async (key: string) => {
        if (key === 'k-broken') throw new Error('r2 delete failed');
      };
      const result = await caller(db).delete({ assetId: ASSET_ID });
      assert.deepEqual(result, { success: true });
      assert.ok(rowDeleted, 'DB row delete must run despite the R2 rejection');
      const variantFailed = logged('media.delete.variant_failed');
      assert.ok(variantFailed, 'expected media.delete.variant_failed event');
      assert.equal(variantFailed.level, 'warn');
      assert.equal(variantFailed.payload.assetId, ASSET_ID);
      assert.equal(variantFailed.payload.key, 'k-broken');
      assert.ok(variantFailed.payload.err instanceof Error);
      const done = logged('media.delete.done');
      assert.ok(done, 'expected media.delete.done event');
      assert.equal(done.payload.variantsDeleted, 1);
      assert.equal(done.payload.variantsFailed, 1);
    });
  });
});
