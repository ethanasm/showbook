/**
 * Pure helpers for per-show quota classification.
 *
 * The upload screen has to do two layers of capacity work, both of
 * which are well-tested in isolation here so the screen itself stays
 * a thin glue layer:
 *
 *   1. After the picker returns, classify each file as `queued`
 *      (within remaining capacity) or `blocked` (would exceed the
 *      per-show photo / video cap). The screen shows blocked rows in
 *      the sheet with a clear reason instead of letting the server
 *      reject them at intent time.
 *
 *   2. Compute the at-cap state for the show-detail "Add media"
 *      entry point so it can be disabled with a useful tooltip when
 *      the user has no remaining capacity at all.
 *
 * The "remaining capacity" inputs are independent of bytes — those
 * are server-side checks that the over-quota screen surfaces if a
 * user manages to slip through. This module only handles the
 * count-based caps (`showMaxPhotos` / `showMaxVideos`) because those
 * are the limits with a stable client-side answer.
 */

import type { SelectedFile } from './types';

export type ClassifiedReason = 'photo_cap' | 'video_cap';

export interface ClassifiedRow {
  file: SelectedFile;
  status: 'queued' | 'blocked';
  reason?: ClassifiedReason;
}

export interface ClassifyInput {
  files: SelectedFile[];
  /** `showMaxPhotos - currentPhotoCount`, never negative. */
  photosRemaining: number;
  /** `showMaxVideos - currentVideoCount`, never negative. */
  videosRemaining: number;
}

/**
 * Classify a batch of picked files against the per-show count caps,
 * in input order. The first `photosRemaining` photos and the first
 * `videosRemaining` videos become `queued`; the rest become `blocked`
 * with a `reason` of `photo_cap` / `video_cap`. Mixed selections are
 * walked left-to-right so the user's earliest picks win the remaining
 * capacity — matches how `expo-image-picker` returns assets in
 * tap-order.
 */
export function classifyPickedFiles({
  files,
  photosRemaining,
  videosRemaining,
}: ClassifyInput): ClassifiedRow[] {
  let photoBudget = Math.max(0, photosRemaining);
  let videoBudget = Math.max(0, videosRemaining);
  return files.map((file) => {
    if (file.mediaType === 'video') {
      if (videoBudget > 0) {
        videoBudget -= 1;
        return { file, status: 'queued' };
      }
      return { file, status: 'blocked', reason: 'video_cap' };
    }
    if (photoBudget > 0) {
      photoBudget -= 1;
      return { file, status: 'queued' };
    }
    return { file, status: 'blocked', reason: 'photo_cap' };
  });
}

export interface CapacitySummary {
  photoLimit: number;
  photoUsed: number;
  /** Photo slots left for THIS show. Clamped at 0. */
  photosRemaining: number;
  videoLimit: number;
  videoUsed: number;
  /** Video slots left for THIS show. Clamped at 0. */
  videosRemaining: number;
  /** True iff BOTH counts are at the cap — entry points hide / disable. */
  atCap: boolean;
}

/**
 * Distill the `media.getQuota({ showId })` response into a single
 * shape the UI components consume. Tolerates the loading shape
 * (`undefined` quota) by returning permissive defaults so the entry
 * point starts in the enabled state until we know otherwise — a
 * "loading → block" flash would be worse UX than the brief moment of
 * possibly-stale enablement.
 */
export function summarizeShowCapacity(quota: {
  limits: { showMaxPhotos: number; showMaxVideos: number };
  used: { showPhotos: number; showVideos: number };
} | undefined): CapacitySummary {
  const photoLimit = quota?.limits.showMaxPhotos ?? Number.POSITIVE_INFINITY;
  const videoLimit = quota?.limits.showMaxVideos ?? Number.POSITIVE_INFINITY;
  const photoUsed = quota?.used.showPhotos ?? 0;
  const videoUsed = quota?.used.showVideos ?? 0;
  const photosRemaining = Math.max(0, photoLimit - photoUsed);
  const videosRemaining = Math.max(0, videoLimit - videoUsed);
  const atCap =
    quota !== undefined && photosRemaining === 0 && videosRemaining === 0;
  return {
    photoLimit,
    photoUsed,
    photosRemaining,
    videoLimit,
    videoUsed,
    videosRemaining,
    atCap,
  };
}

/**
 * Group classified rows by their reason for the banner copy at the
 * top of the upload sheet. Returns the per-reason counts and the
 * total blocked count so a single "X of N can't be added" line can be
 * built without re-walking the array on every render.
 */
export function summarizeBlocked(rows: ClassifiedRow[]): {
  queuedCount: number;
  blockedPhotos: number;
  blockedVideos: number;
  totalBlocked: number;
} {
  let queuedCount = 0;
  let blockedPhotos = 0;
  let blockedVideos = 0;
  for (const row of rows) {
    if (row.status === 'queued') queuedCount += 1;
    else if (row.reason === 'photo_cap') blockedPhotos += 1;
    else if (row.reason === 'video_cap') blockedVideos += 1;
  }
  return {
    queuedCount,
    blockedPhotos,
    blockedVideos,
    totalBlocked: blockedPhotos + blockedVideos,
  };
}
