/**
 * MediaTile — single tile in a media grid (M4).
 *
 * Renders a square thumbnail with optional caption and tag-count overlay.
 * Tag chip shows only when at least one performer is tagged. Long-press
 * is the standard gesture for "edit / re-tag" — short press routes to the
 * lightbox.
 *
 * Pure rendering decisions live in `MediaTile.helpers.ts` so the component
 * contract can be tested under `node:test` without bundling react-native.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../lib/theme';
import { RADII } from '../lib/theme-utils';
import {
  getMediaTilePressableProps,
  getMediaTileVm,
  type MediaTileInput,
} from './MediaTile.helpers';

export {
  getMediaTileVm,
  getMediaTilePressableProps,
  MEDIA_TILE_DEFAULT_SIZE,
} from './MediaTile.helpers';
export type {
  MediaTileVm,
  MediaTileInput,
  MediaTilePressableProps,
  MediaTilePressableHandlers,
} from './MediaTile.helpers';

export interface MediaTileProps extends MediaTileInput {
  onPress?: () => void;
  onLongPress?: () => void;
  testID?: string;
}

export function MediaTile(props: MediaTileProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const vm = getMediaTileVm(props);
  const pressableProps = getMediaTilePressableProps(vm, {
    onPress: props.onPress,
    onLongPress: props.onLongPress,
  });

  return (
    <Pressable
      {...pressableProps}
      testID={props.testID}
      style={({ pressed }) => [
        styles.tile,
        {
          width: vm.size,
          height: vm.size,
          backgroundColor: colors.surface,
          borderColor: colors.rule,
        },
        pressed && styles.pressed,
      ]}
    >
      <Image
        source={{ uri: vm.thumbnailUri }}
        style={styles.image}
        contentFit="cover"
        transition={150}
        accessibilityIgnoresInvertColors
      />
      {vm.chipText !== null ? (
        <View
          style={[styles.chip, { backgroundColor: colors.surfaceRaised, borderColor: colors.rule }]}
          testID={props.testID ? `${props.testID}.chip` : undefined}
        >
          <Text style={[styles.chipText, { color: colors.ink }]} numberOfLines={1}>
            {vm.chipText}
          </Text>
        </View>
      ) : null}
      {vm.caption ? (
        <View style={[styles.captionBar, { backgroundColor: colors.bg + 'CC' }]}>
          <Text
            style={[styles.captionText, { color: colors.ink }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {vm.caption}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: RADII.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  pressed: {
    opacity: 0.85,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  chip: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  captionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  captionText: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
  },
});
