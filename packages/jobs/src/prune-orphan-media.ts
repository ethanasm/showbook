import { db, mediaAssets, type MediaVariant } from '@showbook/db';
import { and, eq, lt, or } from 'drizzle-orm';
import { deleteMediaObject } from '@showbook/api';
import { child } from '@showbook/observability';

const log = child({ component: 'jobs.prune-orphan-media' });

export type PruneOrphanMediaResult = {
  scanned: number;
  rowsDeleted: number;
  objectsDeleted: number;
  objectDeleteFailures: number;
};

/**
 * Sweep terminal-but-stuck media_assets rows and their R2 objects:
 *  - `status = 'failed'` — already known-dead from completeUpload's
 *    oversize guard; the inline R2 cleanup is best-effort so a blob
 *    may still be sitting in the bucket.
 *  - `status = 'pending'` older than 24h — client got the presigned
 *    URL via createUploadIntent but never called completeUpload (app
 *    backgrounded, network died, mobile force-quit). R2 may or may
 *    not hold partial bytes.
 *
 * R2 deletes are best-effort per variant; failures are logged with
 * `prune.orphan_media.delete_failed` and counted in the summary. The
 * DB row is only dropped after every variant delete returns (success
 * or failure) so a permanent R2 outage doesn't accumulate DB rows.
 */
const PENDING_GRACE_MS = 24 * 60 * 60 * 1000;

export async function runPruneOrphanMedia(): Promise<PruneOrphanMediaResult> {
  const cutoff = new Date(Date.now() - PENDING_GRACE_MS);

  const candidates = await db
    .select({
      id: mediaAssets.id,
      status: mediaAssets.status,
      variants: mediaAssets.variants,
    })
    .from(mediaAssets)
    .where(
      or(
        eq(mediaAssets.status, 'failed'),
        and(eq(mediaAssets.status, 'pending'), lt(mediaAssets.createdAt, cutoff)),
      ),
    );

  let objectsDeleted = 0;
  let objectDeleteFailures = 0;
  let rowsDeleted = 0;

  for (const row of candidates) {
    const variants = (row.variants ?? {}) as Record<string, MediaVariant>;
    const results = await Promise.allSettled(
      Object.values(variants).map((v) => deleteMediaObject(v.key)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        objectsDeleted += 1;
      } else {
        objectDeleteFailures += 1;
        log.warn(
          {
            event: 'prune.orphan_media.delete_failed',
            assetId: row.id,
            err: r.reason,
          },
          'R2 delete failed; will retry next run',
        );
      }
    }
    await db.delete(mediaAssets).where(eq(mediaAssets.id, row.id));
    rowsDeleted += 1;
  }

  return {
    scanned: candidates.length,
    rowsDeleted,
    objectsDeleted,
    objectDeleteFailures,
  };
}
