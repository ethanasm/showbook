/**
 * Pure rendering helpers for MediaTile so the component contract can be
 * exercised under `node:test` without bundling react-native source.
 *
 * `getMediaTileVm` decides what's visible (chip, caption) and what text
 * to display. `getMediaTilePressableProps` decides what handlers + a11y
 * props the root Pressable receives. Together they cover the M4 spec
 * cases: thumbnail/caption/chip rendering, hidden chip at count=0, and
 * onLongPress wiring.
 */

export interface MediaTileInput {
  uri: string;
  caption?: string | null;
  tagCount?: number;
  size?: number;
}

export interface MediaTileVm {
  thumbnailUri: string;
  caption: string | null;
  /** null → chip is hidden. Otherwise the rendered text (e.g., "3"). */
  chipText: string | null;
  size: number;
}

export const MEDIA_TILE_DEFAULT_SIZE = 112;

export function getMediaTileVm(props: MediaTileInput): MediaTileVm {
  const tagCount = Math.max(0, Math.floor(props.tagCount ?? 0));
  const trimmedCaption = props.caption?.trim();
  return {
    thumbnailUri: props.uri,
    caption: trimmedCaption ? trimmedCaption : null,
    chipText: tagCount > 0 ? String(tagCount) : null,
    size: props.size ?? MEDIA_TILE_DEFAULT_SIZE,
  };
}

export interface MediaTilePressableHandlers {
  onPress?: () => void;
  onLongPress?: () => void;
}

export interface MediaTilePressableProps {
  accessibilityRole: 'imagebutton';
  accessibilityLabel: string;
  onPress?: () => void;
  onLongPress?: () => void;
  delayLongPress: number;
}

/**
 * Build the props the root Pressable receives. Splitting this out makes
 * "long-press fires onLongPress" verifiable without rendering a RN tree.
 */
export function getMediaTilePressableProps(
  vm: MediaTileVm,
  handlers: MediaTilePressableHandlers,
): MediaTilePressableProps {
  return {
    accessibilityRole: 'imagebutton',
    accessibilityLabel: vm.caption ?? 'Media',
    onPress: handlers.onPress,
    onLongPress: handlers.onLongPress,
    delayLongPress: 350,
  };
}
