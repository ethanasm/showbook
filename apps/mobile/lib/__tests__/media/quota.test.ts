/**
 * Pure-helper tests for the per-show capacity logic that gates the
 * upload screen and the show-detail "Add media" entry point.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { SelectedFile } from '../../media';
import {
  classifyPickedFiles,
  summarizeBlocked,
  summarizeShowCapacity,
} from '../../media/quota';

function photo(uri: string, bytes = 1_000_000): SelectedFile {
  return {
    uri,
    mediaType: 'photo',
    mimeType: 'image/heic',
    bytes,
    width: 4032,
    height: 3024,
  };
}

function video(uri: string, bytes = 10_000_000): SelectedFile {
  return {
    uri,
    mediaType: 'video',
    mimeType: 'video/mp4',
    bytes,
    width: 1920,
    height: 1080,
    durationMs: 5_000,
  };
}

describe('classifyPickedFiles', () => {
  it('queues every file when capacity exceeds selection', () => {
    const out = classifyPickedFiles({
      files: [photo('a'), photo('b'), photo('c')],
      photosRemaining: 10,
      videosRemaining: 1,
    });
    assert.equal(out.length, 3);
    assert.ok(out.every((r) => r.status === 'queued'));
  });

  it('blocks photos beyond the per-show photo cap, in input order', () => {
    // 28 of 30 used → photosRemaining = 2. Pick 5. First two queue,
    // last three block — exactly the scenario the user called out.
    const out = classifyPickedFiles({
      files: [
        photo('1'),
        photo('2'),
        photo('3'),
        photo('4'),
        photo('5'),
      ],
      photosRemaining: 2,
      videosRemaining: 2,
    });
    assert.deepEqual(
      out.map((r) => r.status),
      ['queued', 'queued', 'blocked', 'blocked', 'blocked'],
    );
    assert.ok(out.slice(2).every((r) => r.reason === 'photo_cap'));
  });

  it('counts photo and video budgets independently in a mixed selection', () => {
    // Photos full, videos still have capacity — the video survives.
    const out = classifyPickedFiles({
      files: [photo('p1'), video('v1'), photo('p2'), video('v2')],
      photosRemaining: 0,
      videosRemaining: 1,
    });
    assert.deepEqual(out.map((r) => r.status), [
      'blocked',
      'queued',
      'blocked',
      'blocked',
    ]);
    assert.equal(out[0]?.reason, 'photo_cap');
    assert.equal(out[2]?.reason, 'photo_cap');
    assert.equal(out[3]?.reason, 'video_cap');
  });

  it('treats negative remaining as zero (defensive against stale quota)', () => {
    // A race between client cache and server delete could yield a
    // "remaining" of -1. Don't decrement into the negatives or the
    // next pick after a delete would silently get queued.
    const out = classifyPickedFiles({
      files: [photo('a')],
      photosRemaining: -3,
      videosRemaining: -1,
    });
    assert.equal(out[0]?.status, 'blocked');
    assert.equal(out[0]?.reason, 'photo_cap');
  });

  it('returns [] for an empty selection', () => {
    assert.deepEqual(
      classifyPickedFiles({
        files: [],
        photosRemaining: 30,
        videosRemaining: 2,
      }),
      [],
    );
  });
});

describe('summarizeShowCapacity', () => {
  it('reports remaining slots and atCap=false when there is room', () => {
    const s = summarizeShowCapacity({
      limits: { showMaxPhotos: 30, showMaxVideos: 2 },
      used: { showPhotos: 28, showVideos: 0 },
    });
    assert.equal(s.photosRemaining, 2);
    assert.equal(s.videosRemaining, 2);
    assert.equal(s.atCap, false);
  });

  it('reports atCap=true when BOTH counts hit their caps', () => {
    const s = summarizeShowCapacity({
      limits: { showMaxPhotos: 30, showMaxVideos: 2 },
      used: { showPhotos: 30, showVideos: 2 },
    });
    assert.equal(s.photosRemaining, 0);
    assert.equal(s.videosRemaining, 0);
    assert.equal(s.atCap, true);
  });

  it('reports atCap=false when only ONE count is exhausted', () => {
    // Photos full but videos still have room → the entry point stays
    // enabled because the user can still attach a video. The
    // upload-sheet classification handles the "this specific photo
    // pick can't fit" case row-by-row.
    const s = summarizeShowCapacity({
      limits: { showMaxPhotos: 30, showMaxVideos: 2 },
      used: { showPhotos: 30, showVideos: 0 },
    });
    assert.equal(s.atCap, false);
  });

  it('does not claim atCap on the loading shape (undefined quota)', () => {
    const s = summarizeShowCapacity(undefined);
    // Permissive defaults: never block the user before we know the
    // numbers. A brief enabled flash is better than a brief disabled
    // flash that then snaps back.
    assert.equal(s.atCap, false);
    assert.equal(Number.isFinite(s.photoLimit), false);
  });

  it('clamps negative remaining when used exceeds limit (admin override / race)', () => {
    const s = summarizeShowCapacity({
      limits: { showMaxPhotos: 30, showMaxVideos: 2 },
      used: { showPhotos: 31, showVideos: 0 },
    });
    assert.equal(s.photosRemaining, 0);
  });
});

describe('summarizeBlocked', () => {
  it('returns zero counts for an all-queued selection', () => {
    const s = summarizeBlocked([
      { file: photo('a'), status: 'queued' },
      { file: photo('b'), status: 'queued' },
    ]);
    assert.deepEqual(s, {
      queuedCount: 2,
      blockedPhotos: 0,
      blockedVideos: 0,
      totalBlocked: 0,
    });
  });

  it('splits the count across reasons so the banner can pluralise', () => {
    const s = summarizeBlocked([
      { file: photo('a'), status: 'queued' },
      { file: photo('b'), status: 'blocked', reason: 'photo_cap' },
      { file: photo('c'), status: 'blocked', reason: 'photo_cap' },
      { file: video('v1'), status: 'blocked', reason: 'video_cap' },
    ]);
    assert.deepEqual(s, {
      queuedCount: 1,
      blockedPhotos: 2,
      blockedVideos: 1,
      totalBlocked: 3,
    });
  });
});
