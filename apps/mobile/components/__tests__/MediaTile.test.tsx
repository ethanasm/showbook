/**
 * MediaTile component tests.
 *
 * The mobile test runner is `node:test` with tsx, which can't bundle
 * react-native's Flow source. To keep the test runnable without a renderer,
 * MediaTile factors its rendering decisions into pure helpers in
 * `MediaTile.helpers.ts` (no react-native imports). The test exercises
 * those helpers directly — covering the M4 spec cases:
 *
 *   - Renders thumbnail (vm.thumbnailUri set), caption, tag-count chip
 *   - Tag count chip hidden when count = 0 (vm.chipText is null)
 *   - Long-press fires onLongPress (Pressable props carry the handler)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getMediaTilePressableProps,
  getMediaTileVm,
  MEDIA_TILE_DEFAULT_SIZE,
} from '../MediaTile.helpers';

// ---------------------------------------------------------------------------
// getMediaTileVm — what the tile shows
// ---------------------------------------------------------------------------

describe('getMediaTileVm', () => {
  it('renders thumbnail, caption, and tag-count chip when count > 0', () => {
    const vm = getMediaTileVm({
      uri: 'file:///photo.jpg',
      caption: 'Encore',
      tagCount: 3,
    });
    assert.equal(vm.thumbnailUri, 'file:///photo.jpg');
    assert.equal(vm.caption, 'Encore');
    assert.equal(vm.chipText, '3');
    assert.equal(vm.size, MEDIA_TILE_DEFAULT_SIZE);
  });

  it('hides the tag chip when tagCount = 0', () => {
    assert.equal(getMediaTileVm({ uri: 'u', tagCount: 0 }).chipText, null);
    assert.equal(getMediaTileVm({ uri: 'u' }).chipText, null);
  });

  it('treats empty/whitespace captions as null (no caption bar)', () => {
    assert.equal(getMediaTileVm({ uri: 'u', caption: '' }).caption, null);
    assert.equal(getMediaTileVm({ uri: 'u', caption: '   ' }).caption, null);
    assert.equal(getMediaTileVm({ uri: 'u', caption: undefined }).caption, null);
  });

  it('clamps negative tag counts and floors fractional ones', () => {
    assert.equal(getMediaTileVm({ uri: 'u', tagCount: -3 }).chipText, null);
    assert.equal(getMediaTileVm({ uri: 'u', tagCount: 3.7 }).chipText, '3');
  });

  it('honours an explicit size override', () => {
    assert.equal(getMediaTileVm({ uri: 'u', size: 84 }).size, 84);
  });
});

// ---------------------------------------------------------------------------
// getMediaTilePressableProps — long-press wiring
// ---------------------------------------------------------------------------

describe('getMediaTilePressableProps', () => {
  it('passes onLongPress through so a long-press fires the caller handler', () => {
    let pressed = 0;
    const handler = (): void => {
      pressed++;
    };
    const vm = getMediaTileVm({ uri: 'u' });
    const props = getMediaTilePressableProps(vm, { onLongPress: handler });

    assert.equal(typeof props.onLongPress, 'function');
    props.onLongPress!();
    assert.equal(pressed, 1, 'onLongPress should fire when invoked from the Pressable');
  });

  it('passes onPress through alongside long-press', () => {
    let shortPresses = 0;
    let longPresses = 0;
    const props = getMediaTilePressableProps(getMediaTileVm({ uri: 'u' }), {
      onPress: () => {
        shortPresses++;
      },
      onLongPress: () => {
        longPresses++;
      },
    });
    props.onPress!();
    props.onLongPress!();
    assert.equal(shortPresses, 1);
    assert.equal(longPresses, 1);
  });

  it('uses the caption as the accessibility label when present', () => {
    const props = getMediaTilePressableProps(
      getMediaTileVm({ uri: 'u', caption: 'Backstage' }),
      {},
    );
    assert.equal(props.accessibilityLabel, 'Backstage');
    assert.equal(props.accessibilityRole, 'imagebutton');
  });

  it('falls back to a generic label when no caption is set', () => {
    const props = getMediaTilePressableProps(getMediaTileVm({ uri: 'u' }), {});
    assert.equal(props.accessibilityLabel, 'Media');
  });
});
