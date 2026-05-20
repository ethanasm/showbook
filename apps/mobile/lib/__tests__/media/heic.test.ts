import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeForUpload,
  shouldConvertHeic,
  type NormalizerDeps,
} from '../../media/heic';
import type { SelectedFile } from '../../media/types';

function fakeHeic(overrides: Partial<SelectedFile> = {}): SelectedFile {
  return {
    uri: 'file:///private/IMG_0001.HEIC',
    mediaType: 'photo',
    mimeType: 'image/heic',
    bytes: 2_276_668,
    width: 4032,
    height: 3024,
    ...overrides,
  };
}

function stubDeps(overrides: Partial<NormalizerDeps> = {}): NormalizerDeps {
  return {
    manipulate: async () => ({
      uri: 'file:///cache/converted.jpg',
      width: 4032,
      height: 3024,
    }),
    measureBytes: async () => 1_500_000,
    ...overrides,
  };
}

describe('shouldConvertHeic', () => {
  it('matches HEIC + HEIF case-insensitively', () => {
    assert.equal(shouldConvertHeic({ mediaType: 'photo', mimeType: 'image/heic' }), true);
    assert.equal(shouldConvertHeic({ mediaType: 'photo', mimeType: 'image/HEIC' }), true);
    assert.equal(shouldConvertHeic({ mediaType: 'photo', mimeType: 'image/heif' }), true);
  });

  it('does not convert JPEG / PNG / WebP', () => {
    assert.equal(shouldConvertHeic({ mediaType: 'photo', mimeType: 'image/jpeg' }), false);
    assert.equal(shouldConvertHeic({ mediaType: 'photo', mimeType: 'image/png' }), false);
    assert.equal(shouldConvertHeic({ mediaType: 'photo', mimeType: 'image/webp' }), false);
  });

  it('never converts videos, even if mislabelled as HEIC', () => {
    assert.equal(shouldConvertHeic({ mediaType: 'video', mimeType: 'image/heic' }), false);
  });
});

describe('normalizeForUpload', () => {
  it('re-encodes HEIC to JPEG and returns the converted URI + sizes', async () => {
    const calls: string[] = [];
    const deps = stubDeps({
      manipulate: async (uri) => {
        calls.push(`manipulate:${uri}`);
        return { uri: 'file:///cache/abc.jpg', width: 2016, height: 1512 };
      },
      measureBytes: async (uri) => {
        calls.push(`measure:${uri}`);
        return 421_337;
      },
    });

    const result = await normalizeForUpload(fakeHeic(), deps);

    assert.equal(result.mimeType, 'image/jpeg');
    assert.equal(result.uri, 'file:///cache/abc.jpg');
    assert.equal(result.bytes, 421_337);
    assert.equal(result.width, 2016);
    assert.equal(result.height, 1512);
    assert.deepEqual(calls, [
      'manipulate:file:///private/IMG_0001.HEIC',
      'measure:file:///cache/abc.jpg',
    ]);
  });

  it('preserves non-conversion fields (mediaType, caption, etc.)', async () => {
    const result = await normalizeForUpload(
      fakeHeic({ caption: 'Encore', durationMs: undefined }),
      stubDeps(),
    );
    assert.equal(result.caption, 'Encore');
    assert.equal(result.mediaType, 'photo');
  });

  it('falls back to original width/height if the manipulator returns 0', async () => {
    const result = await normalizeForUpload(
      fakeHeic({ width: 4032, height: 3024 }),
      stubDeps({
        manipulate: async () => ({ uri: 'file:///cache/x.jpg', width: 0, height: 0 }),
      }),
    );
    assert.equal(result.width, 4032);
    assert.equal(result.height, 3024);
  });

  it('returns non-HEIC files untouched and does not call the manipulator', async () => {
    let manipulateCalled = false;
    const deps = stubDeps({
      manipulate: async () => {
        manipulateCalled = true;
        return { uri: 'should-not-be-used', width: 0, height: 0 };
      },
    });
    const jpeg: SelectedFile = {
      uri: 'file:///private/IMG_0002.JPG',
      mediaType: 'photo',
      mimeType: 'image/jpeg',
      bytes: 1_000_000,
    };

    const result = await normalizeForUpload(jpeg, deps);
    assert.equal(manipulateCalled, false);
    assert.equal(result, jpeg);
  });

  it('propagates manipulator failures so uploadFile can surface them', async () => {
    await assert.rejects(
      normalizeForUpload(
        fakeHeic(),
        stubDeps({
          manipulate: async () => {
            throw new Error('decode failed');
          },
        }),
      ),
      /decode failed/,
    );
  });
});
