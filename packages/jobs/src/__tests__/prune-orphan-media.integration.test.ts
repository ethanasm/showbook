/**
 * Integration tests for runPruneOrphanMedia: the daily cron at 02:45 ET
 * that sweeps terminal media_assets (status='failed' or pending >24h)
 * and their R2 objects.
 *
 * Tests run with MEDIA_STORAGE_MODE=local so deleteMediaObject hits the
 * filesystem instead of R2; that's the same swap the dev/Playwright
 * harness uses, so we exercise the real code path with a local backing
 * store.
 *
 * Run with:
 *   pnpm --filter @showbook/jobs test:integration
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  db,
  users,
  shows,
  venues,
  mediaAssets,
  sql,
} from '@showbook/db';
import { like, eq } from 'drizzle-orm';
import { runPruneOrphanMedia } from '../prune-orphan-media';

const PREFIX = 'eea0d1a0';

const USER_A = `${PREFIX}-1111-4111-8111-111111111111`;
const VENUE = `${PREFIX}-aaaa-4aaa-8aaa-aaaaaaaaaaa1`;
const SHOW = `${PREFIX}-dddd-4ddd-8ddd-dddddddddd01`;

const ASSET_FAILED = `${PREFIX}-f000-4f00-8f00-f00000000001`;
const ASSET_PENDING_OLD = `${PREFIX}-f000-4f00-8f00-f00000000002`;
const ASSET_PENDING_FRESH = `${PREFIX}-f000-4f00-8f00-f00000000003`;
const ASSET_READY = `${PREFIX}-f000-4f00-8f00-f00000000004`;

const LOCAL_ROOT = path.join(
  os.tmpdir(),
  `showbook-prune-orphan-media-${PREFIX}`,
);

async function cleanup(): Promise<void> {
  const p = `${PREFIX}%`;
  await db.delete(mediaAssets).where(like(sql`${mediaAssets.id}::text`, p));
  await db.delete(shows).where(like(sql`${shows.id}::text`, p));
  await db.delete(venues).where(like(sql`${venues.id}::text`, p));
  await db.delete(users).where(like(users.id, p));
}

async function writeFakeBlob(key: string): Promise<string> {
  const fullPath = path.join(LOCAL_ROOT, key);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, 'fixture-bytes');
  return fullPath;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function variantFor(assetId: string, name: string) {
  return {
    key: `showbook/${USER_A}/shows/${SHOW}/photos/${assetId}/${name}.webp`,
    mimeType: 'image/webp',
    bytes: 12,
    width: null,
    height: null,
  };
}

describe('runPruneOrphanMedia', () => {
  before(async () => {
    process.env.MEDIA_STORAGE_MODE = 'local';
    process.env.MEDIA_LOCAL_UPLOAD_ROOT = LOCAL_ROOT;
    await cleanup();
  });
  after(async () => {
    await cleanup();
  });
  beforeEach(cleanup);

  it('sweeps failed + stale-pending rows and their local blobs; preserves ready + fresh-pending', async () => {
    const now = Date.now();
    const stale = new Date(now - 25 * 60 * 60 * 1000); // 25h ago
    const fresh = new Date(now - 60 * 60 * 1000);     // 1h ago

    // Seed user + venue + show inside a single tx so a sibling sweep
    // can't observe an intermediate state (same pattern as
    // prune-past-announcements.integration.test.ts).
    await db.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: USER_A, name: 'A', email: 'a@test.local' },
      ]);
      await tx.insert(venues).values([
        { id: VENUE, name: 'Hall', city: 'NYC', country: 'US' },
      ]);
      await tx.insert(shows).values([
        {
          id: SHOW,
          userId: USER_A,
          venueId: VENUE,
          kind: 'concert',
          state: 'past',
          date: '2020-01-01',
        },
      ]);
      await tx.insert(mediaAssets).values([
        {
          id: ASSET_FAILED,
          userId: USER_A,
          showId: SHOW,
          mediaType: 'photo',
          status: 'failed',
          storageKey: `showbook/${USER_A}/shows/${SHOW}/photos/${ASSET_FAILED}`,
          mimeType: 'image/webp',
          bytes: 24,
          variants: {
            display: variantFor(ASSET_FAILED, 'display'),
            thumb: variantFor(ASSET_FAILED, 'thumb'),
          },
          sortOrder: 0,
        },
        {
          id: ASSET_PENDING_OLD,
          userId: USER_A,
          showId: SHOW,
          mediaType: 'photo',
          status: 'pending',
          storageKey: `showbook/${USER_A}/shows/${SHOW}/photos/${ASSET_PENDING_OLD}`,
          mimeType: 'image/webp',
          bytes: 12,
          variants: { display: variantFor(ASSET_PENDING_OLD, 'display') },
          sortOrder: 1,
          createdAt: stale,
          updatedAt: stale,
        },
        {
          id: ASSET_PENDING_FRESH,
          userId: USER_A,
          showId: SHOW,
          mediaType: 'photo',
          status: 'pending',
          storageKey: `showbook/${USER_A}/shows/${SHOW}/photos/${ASSET_PENDING_FRESH}`,
          mimeType: 'image/webp',
          bytes: 12,
          variants: { display: variantFor(ASSET_PENDING_FRESH, 'display') },
          sortOrder: 2,
          createdAt: fresh,
          updatedAt: fresh,
        },
        {
          id: ASSET_READY,
          userId: USER_A,
          showId: SHOW,
          mediaType: 'photo',
          status: 'ready',
          storageKey: `showbook/${USER_A}/shows/${SHOW}/photos/${ASSET_READY}`,
          mimeType: 'image/webp',
          bytes: 12,
          variants: { display: variantFor(ASSET_READY, 'display') },
          sortOrder: 3,
        },
      ]);
    });

    const failedDisplayPath = await writeFakeBlob(variantFor(ASSET_FAILED, 'display').key);
    const failedThumbPath = await writeFakeBlob(variantFor(ASSET_FAILED, 'thumb').key);
    const pendingOldPath = await writeFakeBlob(variantFor(ASSET_PENDING_OLD, 'display').key);
    const pendingFreshPath = await writeFakeBlob(variantFor(ASSET_PENDING_FRESH, 'display').key);
    const readyPath = await writeFakeBlob(variantFor(ASSET_READY, 'display').key);

    const result = await runPruneOrphanMedia();

    assert.ok(result.scanned >= 2, `scanned at least the failed+stale rows (got ${result.scanned})`);
    assert.ok(result.rowsDeleted >= 2, `deleted at least 2 DB rows (got ${result.rowsDeleted})`);
    assert.ok(result.objectsDeleted >= 3, `deleted >=3 blobs (2 from failed + 1 from stale pending, got ${result.objectsDeleted})`);
    assert.equal(result.objectDeleteFailures, 0);

    // DB side
    const failed = await db.select().from(mediaAssets).where(eq(mediaAssets.id, ASSET_FAILED));
    const stalePending = await db.select().from(mediaAssets).where(eq(mediaAssets.id, ASSET_PENDING_OLD));
    const freshPending = await db.select().from(mediaAssets).where(eq(mediaAssets.id, ASSET_PENDING_FRESH));
    const ready = await db.select().from(mediaAssets).where(eq(mediaAssets.id, ASSET_READY));
    assert.equal(failed.length, 0, 'failed asset deleted');
    assert.equal(stalePending.length, 0, 'stale-pending asset deleted');
    assert.equal(freshPending.length, 1, 'fresh-pending asset preserved (still in grace window)');
    assert.equal(ready.length, 1, 'ready asset preserved');

    // Filesystem side
    assert.equal(await exists(failedDisplayPath), false, 'failed display blob gone');
    assert.equal(await exists(failedThumbPath), false, 'failed thumb blob gone');
    assert.equal(await exists(pendingOldPath), false, 'stale-pending blob gone');
    assert.equal(await exists(pendingFreshPath), true, 'fresh-pending blob preserved');
    assert.equal(await exists(readyPath), true, 'ready blob preserved');
  });

  it('still deletes the DB row when the blob is already missing (no double-delete crash)', async () => {
    // Mirrors the case where completeUpload's inline cleanup succeeded
    // for a failed asset but the row stayed in 'failed' — second sweep
    // shouldn't blow up because the file is gone.
    await db.transaction(async (tx) => {
      await tx.insert(users).values([
        { id: USER_A, name: 'A', email: 'a@test.local' },
      ]);
      await tx.insert(venues).values([
        { id: VENUE, name: 'Hall', city: 'NYC', country: 'US' },
      ]);
      await tx.insert(shows).values([
        {
          id: SHOW,
          userId: USER_A,
          venueId: VENUE,
          kind: 'concert',
          state: 'past',
          date: '2020-01-01',
        },
      ]);
      await tx.insert(mediaAssets).values([
        {
          id: ASSET_FAILED,
          userId: USER_A,
          showId: SHOW,
          mediaType: 'photo',
          status: 'failed',
          storageKey: `showbook/${USER_A}/shows/${SHOW}/photos/${ASSET_FAILED}`,
          mimeType: 'image/webp',
          bytes: 12,
          variants: { display: variantFor(ASSET_FAILED, 'display') },
          sortOrder: 0,
        },
      ]);
    });
    // No writeFakeBlob — file deliberately absent.

    const result = await runPruneOrphanMedia();

    assert.ok(result.rowsDeleted >= 1);
    assert.equal(result.objectDeleteFailures, 0, 'ENOENT is swallowed by deleteLocalObject');
    const remaining = await db.select().from(mediaAssets).where(eq(mediaAssets.id, ASSET_FAILED));
    assert.equal(remaining.length, 0);
  });
});
