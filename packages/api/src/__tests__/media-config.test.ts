import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getMediaConfig } from '../media-config';

const envKeys = [
  'MEDIA_STORAGE_MODE',
  'MEDIA_GLOBAL_QUOTA_BYTES',
  'MEDIA_USER_QUOTA_BYTES',
  'MEDIA_SHOW_QUOTA_BYTES',
  'MEDIA_ALLOWED_IMAGE_TYPES',
  'MEDIA_ALLOWED_VIDEO_TYPES',
] as const;

const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of envKeys) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnv.clear();
});

describe('media config', () => {
  it('uses conservative free-tier defaults', () => {
    const config = getMediaConfig();

    assert.equal(config.storageMode, 'r2');
    assert.equal(config.globalQuotaBytes, 8_589_934_592);
    assert.equal(config.userQuotaBytes, 1_073_741_824);
    assert.equal(config.showQuotaBytes, 314_572_800);
    assert.equal(config.videoMaxBytes, 157_286_400);
    assert.equal(config.showMaxPhotos, 30);
    assert.equal(config.showMaxVideos, 2);
  });

  it('accepts explicit env overrides and normalizes type lists', () => {
    process.env.MEDIA_STORAGE_MODE = 'local';
    process.env.MEDIA_GLOBAL_QUOTA_BYTES = '1000';
    process.env.MEDIA_USER_QUOTA_BYTES = '500';
    process.env.MEDIA_ALLOWED_IMAGE_TYPES = ' image/jpeg,IMAGE/PNG ';
    process.env.MEDIA_ALLOWED_VIDEO_TYPES = ' video/mp4 ';

    const config = getMediaConfig();

    assert.equal(config.storageMode, 'local');
    assert.equal(config.globalQuotaBytes, 1000);
    assert.equal(config.userQuotaBytes, 500);
    assert.deepEqual(config.allowedImageTypes, ['image/jpeg', 'image/png']);
    assert.deepEqual(config.allowedVideoTypes, ['video/mp4']);
  });

  it('falls back when numeric env values are invalid', () => {
    process.env.MEDIA_SHOW_QUOTA_BYTES = 'nope';

    const config = getMediaConfig();

    assert.equal(config.showQuotaBytes, 314_572_800);
  });
});
