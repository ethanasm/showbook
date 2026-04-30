/**
 * Integration coverage for routers/media.ts. Exercises getQuota,
 * createUploadIntent, completeUpload, listForShow, listForVenue,
 * listForPerformer, setPerformers (happy path), and delete.
 *
 * Storage is forced to MEDIA_STORAGE_MODE=local so we never call out to R2.
 * The local upload storage writes to disk under MEDIA_LOCAL_UPLOAD_ROOT;
 * we point that at a tmp dir scoped to this test's prefix so traffic is
 * isolated.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     MEDIA_STORAGE_MODE=local \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/media.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TRPCError } from '@trpc/server';
import {
  db,
  mediaAssets,
  performers,
  shows,
  showPerformers,
  venues,
} from '@showbook/db';
import { eq, like, inArray } from 'drizzle-orm';
import {
  callerFor,
  cleanupByPrefix,
  createTestShow,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'dd222222';

// Force local storage for predictable behaviour.
process.env.MEDIA_STORAGE_MODE = 'local';

const USER = `${PREFIX}-user`;
const OTHER = `${PREFIX}-other`;
const VENUE_ID = fakeUuid(PREFIX, 'venue');
const SHOW_ID = fakeUuid(PREFIX, 'show');
const SHOW_2 = fakeUuid(PREFIX, 'show2');
const SHOW_OTHER = fakeUuid(PREFIX, 'showo');
const SHOW_FUTURE = fakeUuid(PREFIX, 'showf');
const PERFORMER_ID = fakeUuid(PREFIX, 'perf');

let tmpRoot: string;

async function seedReadyAsset(opts: {
  id: string;
  userId: string;
  showId: string;
  bytes: number;
  caption?: string;
  variants?: Record<string, { key: string; mimeType: string; bytes: number; width?: number | null; height?: number | null }>;
}): Promise<void> {
  const variants = opts.variants ?? {
    source: {
      key: `showbook/${opts.userId}/shows/${opts.showId}/photos/${opts.id}/source.webp`,
      mimeType: 'image/webp',
      bytes: opts.bytes,
      width: 800,
      height: 600,
    },
  };
  // Touch each variant on disk so headMediaObject (used in completeUpload)
  // works for any later complete calls. listForShow only needs the row.
  for (const v of Object.values(variants)) {
    const target = path.join(tmpRoot, v.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.alloc(v.bytes));
  }
  await db.insert(mediaAssets).values({
    id: opts.id,
    userId: opts.userId,
    showId: opts.showId,
    mediaType: 'photo',
    status: 'ready',
    storageKey: variants.source?.key ?? Object.values(variants)[0]!.key,
    mimeType: 'image/webp',
    bytes: opts.bytes,
    caption: opts.caption ?? null,
    variants,
  }).onConflictDoNothing();
}

describe('media router', () => {
  before(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), `showbook-media-${PREFIX}-`));
    process.env.MEDIA_LOCAL_UPLOAD_ROOT = tmpRoot;

    await cleanupByPrefix(PREFIX);
    await createTestUser(USER);
    await createTestUser(OTHER);
    await createTestVenue({
      id: VENUE_ID,
      name: `${PREFIX} Media Venue`,
      city: 'Detroit',
    });
    await createTestShow({
      id: SHOW_ID,
      userId: USER,
      venueId: VENUE_ID,
      kind: 'concert',
      state: 'past',
      date: '2024-05-01',
    });
    await createTestShow({
      id: SHOW_2,
      userId: USER,
      venueId: VENUE_ID,
      kind: 'concert',
      state: 'past',
      date: '2024-05-02',
    });
    await createTestShow({
      id: SHOW_OTHER,
      userId: OTHER,
      venueId: VENUE_ID,
      kind: 'concert',
      state: 'past',
      date: '2024-05-03',
    });
    await createTestShow({
      id: SHOW_FUTURE,
      userId: USER,
      venueId: VENUE_ID,
      kind: 'concert',
      state: 'ticketed',
      date: '2099-01-01',
    });
    await db.insert(performers).values({
      id: PERFORMER_ID,
      name: `${PREFIX} Performer`,
    }).onConflictDoNothing();
    await db.insert(showPerformers).values({
      showId: SHOW_ID,
      performerId: PERFORMER_ID,
      role: 'headliner',
      sortOrder: 0,
    }).onConflictDoNothing();
  });

  after(async () => {
    await db.delete(mediaAssets).where(inArray(mediaAssets.userId, [USER, OTHER]));
    await db.delete(shows).where(inArray(shows.userId, [USER, OTHER]));
    await db.delete(performers).where(like(performers.name, `${PREFIX}%`));
    await db.delete(venues).where(like(venues.name, `${PREFIX}%`));
    await cleanupByPrefix(PREFIX);
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('getQuota without a showId returns global/user usage', async () => {
    const result = await callerFor(USER).media.getQuota();
    assert.equal(typeof result.used.globalBytes, 'number');
    assert.equal(typeof result.used.userBytes, 'number');
    assert.equal(result.used.showBytes, 0);
    assert.equal(result.used.showPhotos, 0);
    assert.equal(result.limits.globalBytes > 0, true);
  });

  it('getQuota with a showId returns per-show usage', async () => {
    // Seed a ready asset on this show.
    const assetId = fakeUuid(PREFIX, 'qa1');
    await seedReadyAsset({ id: assetId, userId: USER, showId: SHOW_ID, bytes: 1000 });
    const result = await callerFor(USER).media.getQuota({ showId: SHOW_ID });
    assert.ok(result.used.showBytes >= 1000);
    assert.ok(result.used.showPhotos >= 1);
  });

  it('getQuota rejects when showId belongs to another user', async () => {
    await assert.rejects(
      () => callerFor(USER).media.getQuota({ showId: SHOW_OTHER }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });

  it('createUploadIntent creates a pending asset and returns upload targets', async () => {
    const result = await callerFor(USER).media.createUploadIntent({
      showId: SHOW_ID,
      mediaType: 'photo',
      mimeType: 'image/jpeg',
      sourceBytes: 200_000,
      storedBytes: 80_000,
      width: 1024,
      height: 768,
      caption: 'A great moment',
      performerIds: [PERFORMER_ID],
      variants: [
        { name: 'source', mimeType: 'image/webp', bytes: 60_000, width: 1024, height: 768 },
        { name: 'thumb', mimeType: 'image/webp', bytes: 20_000, width: 256, height: 192 },
      ],
    });
    assert.ok(result.assetId);
    assert.equal(result.targets.length, 2);
    for (const t of result.targets) {
      assert.ok(t.uploadUrl.startsWith('/api/media/upload'));
    }

    // Asset row was inserted as 'pending'.
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, result.assetId));
    assert.equal(row?.status, 'pending');
    assert.equal(row?.caption, 'A great moment');
  });

  it('createUploadIntent rejects unsupported mime types', async () => {
    await assert.rejects(
      () => callerFor(USER).media.createUploadIntent({
        showId: SHOW_ID,
        mediaType: 'photo',
        mimeType: 'image/bmp',
        sourceBytes: 10,
        storedBytes: 10,
        variants: [{ name: 'source', mimeType: 'image/bmp', bytes: 10 }],
      }),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });

  it('createUploadIntent enforces video mime type', async () => {
    await assert.rejects(
      () => callerFor(USER).media.createUploadIntent({
        showId: SHOW_ID,
        mediaType: 'video',
        mimeType: 'video/quicktime',
        sourceBytes: 10,
        storedBytes: 10,
        variants: [{ name: 'source', mimeType: 'video/quicktime', bytes: 10 }],
      }),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });

  it('createUploadIntent rejects oversize photo source', async () => {
    await assert.rejects(
      () => callerFor(USER).media.createUploadIntent({
        showId: SHOW_ID,
        mediaType: 'photo',
        mimeType: 'image/jpeg',
        sourceBytes: 21_000_000, // > 20 MiB default
        storedBytes: 10,
        variants: [{ name: 'source', mimeType: 'image/webp', bytes: 10 }],
      }),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });

  it('createUploadIntent rejects oversize photo stored bytes', async () => {
    await assert.rejects(
      () => callerFor(USER).media.createUploadIntent({
        showId: SHOW_ID,
        mediaType: 'photo',
        mimeType: 'image/jpeg',
        sourceBytes: 1000,
        storedBytes: 6_000_000, // > 5 MiB default photoMaxStoredBytes
        variants: [{ name: 'source', mimeType: 'image/webp', bytes: 6_000_000 }],
      }),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });

  it('createUploadIntent rejects oversize video', async () => {
    await assert.rejects(
      () => callerFor(USER).media.createUploadIntent({
        showId: SHOW_ID,
        mediaType: 'video',
        mimeType: 'video/mp4',
        sourceBytes: 200_000_000,
        storedBytes: 200_000_000, // > 150 MiB default
        variants: [{ name: 'source', mimeType: 'video/mp4', bytes: 200_000_000 }],
      }),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });

  it('createUploadIntent rejects when the event has not happened yet', async () => {
    await assert.rejects(
      () => callerFor(USER).media.createUploadIntent({
        showId: SHOW_FUTURE,
        mediaType: 'photo',
        mimeType: 'image/jpeg',
        sourceBytes: 1000,
        storedBytes: 1000,
        variants: [{ name: 'source', mimeType: 'image/webp', bytes: 1000 }],
      }),
      (err: unknown) =>
        err instanceof TRPCError &&
        err.code === 'BAD_REQUEST' &&
        /past/i.test(err.message),
    );
  });

  it('createUploadIntent rejects when storage is disabled', async () => {
    const prev = process.env.MEDIA_STORAGE_MODE;
    process.env.MEDIA_STORAGE_MODE = 'disabled';
    try {
      await assert.rejects(
        () => callerFor(USER).media.createUploadIntent({
          showId: SHOW_ID,
          mediaType: 'photo',
          mimeType: 'image/jpeg',
          sourceBytes: 1000,
          storedBytes: 1000,
          variants: [{ name: 'source', mimeType: 'image/webp', bytes: 1000 }],
        }),
        (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
      );
    } finally {
      process.env.MEDIA_STORAGE_MODE = prev;
    }
  });

  it('completeUpload promotes a pending asset to ready when bytes match', async () => {
    // Create a pending asset, write the matching bytes to disk, then complete.
    const intent = await callerFor(USER).media.createUploadIntent({
      showId: SHOW_ID,
      mediaType: 'photo',
      mimeType: 'image/jpeg',
      sourceBytes: 500,
      storedBytes: 500,
      variants: [{ name: 'source', mimeType: 'image/webp', bytes: 500 }],
    });
    const [created] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, intent.assetId));
    const sourceVariant = created!.variants!.source!;
    const target = path.join(tmpRoot, sourceVariant.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.alloc(500));

    const dto = await callerFor(USER).media.completeUpload({ assetId: intent.assetId });
    assert.equal(dto.status, 'ready');
    assert.ok(dto.urls.source);

    // Calling again should be a no-op (asset already 'ready').
    const dto2 = await callerFor(USER).media.completeUpload({ assetId: intent.assetId });
    assert.equal(dto2.status, 'ready');
  });

  it('completeUpload marks asset failed when uploaded bytes exceed reserved size', async () => {
    const intent = await callerFor(USER).media.createUploadIntent({
      showId: SHOW_ID,
      mediaType: 'photo',
      mimeType: 'image/jpeg',
      sourceBytes: 100,
      storedBytes: 100,
      variants: [{ name: 'source', mimeType: 'image/webp', bytes: 100 }],
    });
    const [created] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, intent.assetId));
    const sourceVariant = created!.variants!.source!;
    const target = path.join(tmpRoot, sourceVariant.key);
    await mkdir(path.dirname(target), { recursive: true });
    // Write more than reserved.
    await writeFile(target, Buffer.alloc(200));

    await assert.rejects(
      () => callerFor(USER).media.completeUpload({ assetId: intent.assetId }),
      (err: unknown) => err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, intent.assetId));
    assert.equal(row?.status, 'failed');
  });

  it('completeUpload rejects unknown asset', async () => {
    await assert.rejects(
      () => callerFor(USER).media.completeUpload({ assetId: '00000000-0000-0000-0000-000000000000' }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });

  it('listForShow returns only the show’s ready assets', async () => {
    const dtos = await callerFor(USER).media.listForShow({ showId: SHOW_ID });
    assert.ok(Array.isArray(dtos));
    assert.ok(dtos.every((d) => d.status === 'ready'));
  });

  it('listForVenue returns assets across the user’s shows at that venue', async () => {
    const aid = fakeUuid(PREFIX, 'venueasset');
    await seedReadyAsset({ id: aid, userId: USER, showId: SHOW_2, bytes: 700 });
    const dtos = await callerFor(USER).media.listForVenue({ venueId: VENUE_ID });
    assert.ok(dtos.length >= 1);
    assert.ok(dtos.some((d) => d.id === aid));
  });

  it('listForVenue returns [] when the user has no shows at the venue', async () => {
    const otherVenue = fakeUuid(PREFIX, 'othervenue');
    await createTestVenue({ id: otherVenue, name: `${PREFIX} Other`, city: 'X' });
    const dtos = await callerFor(USER).media.listForVenue({ venueId: otherVenue });
    assert.deepEqual(dtos, []);
  });

  it('listForPerformer returns assets tagged with the performer', async () => {
    const aid = fakeUuid(PREFIX, 'perfasset');
    await seedReadyAsset({ id: aid, userId: USER, showId: SHOW_ID, bytes: 500 });
    // Tag this asset with the performer via setPerformers.
    await callerFor(USER).media.setPerformers({
      assetId: aid,
      performerIds: [PERFORMER_ID],
    });
    const dtos = await callerFor(USER).media.listForPerformer({ performerId: PERFORMER_ID });
    assert.ok(dtos.some((d) => d.id === aid));
  });

  it('listForPerformer returns [] when the performer has no assets', async () => {
    const performerWithNoAssets = fakeUuid(PREFIX, 'perfempty');
    await db.insert(performers).values({ id: performerWithNoAssets, name: `${PREFIX} Empty Performer` }).onConflictDoNothing();
    const dtos = await callerFor(USER).media.listForPerformer({ performerId: performerWithNoAssets });
    assert.deepEqual(dtos, []);
  });

  it('setPerformers happy path: tags performers, auto-adds to show if needed', async () => {
    const newPerformer = fakeUuid(PREFIX, 'newperf');
    await db.insert(performers).values({ id: newPerformer, name: `${PREFIX} Auto Add` }).onConflictDoNothing();
    const aid = fakeUuid(PREFIX, 'spasset');
    await seedReadyAsset({ id: aid, userId: USER, showId: SHOW_ID, bytes: 400 });

    const result = await callerFor(USER).media.setPerformers({
      assetId: aid,
      performerIds: [newPerformer],
    });
    assert.deepEqual(result.performerIds, [newPerformer]);

    // showPerformers should have an auto-added 'support' row for newPerformer.
    const sp = await db.select().from(showPerformers).where(eq(showPerformers.showId, SHOW_ID));
    assert.ok(sp.some((row) => row.performerId === newPerformer));
  });

  it('setPerformers ignores unknown performerIds', async () => {
    const aid = fakeUuid(PREFIX, 'spunk');
    await seedReadyAsset({ id: aid, userId: USER, showId: SHOW_ID, bytes: 300 });
    const result = await callerFor(USER).media.setPerformers({
      assetId: aid,
      performerIds: [fakeUuid(PREFIX, 'unknownperf')],
    });
    assert.deepEqual(result.performerIds, []);
  });

  it('setPerformers with empty list clears the asset’s tags', async () => {
    const aid = fakeUuid(PREFIX, 'spclear');
    await seedReadyAsset({ id: aid, userId: USER, showId: SHOW_ID, bytes: 250 });
    await callerFor(USER).media.setPerformers({
      assetId: aid,
      performerIds: [PERFORMER_ID],
    });
    const after = await callerFor(USER).media.setPerformers({
      assetId: aid,
      performerIds: [],
    });
    assert.deepEqual(after.performerIds, []);
  });

  it('delete removes the asset', async () => {
    const aid = fakeUuid(PREFIX, 'delasset');
    await seedReadyAsset({ id: aid, userId: USER, showId: SHOW_ID, bytes: 100 });
    const r = await callerFor(USER).media.delete({ assetId: aid });
    assert.deepEqual(r, { success: true });
    const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, aid));
    assert.equal(row, undefined);
  });

  it('delete rejects unknown asset', async () => {
    await assert.rejects(
      () => callerFor(USER).media.delete({ assetId: '00000000-0000-0000-0000-000000000000' }),
      (err: unknown) => err instanceof TRPCError && err.code === 'NOT_FOUND',
    );
  });
});
