/**
 * PreviewMiniPlayer — floating capsule that surfaces whatever 30-second
 * preview is currently playing. Mounted once near the top of the
 * provider tree so it stays visible across navigation between the show
 * detail, song detail, and artist detail screens; tapping the capsule
 * (or letting the clip end naturally) stops playback and hides the
 * capsule on its own.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../lib/theme';
import { RADII } from '../lib/theme-utils';
import { usePreviewPlayer } from '../lib/preview-player-provider';

export function PreviewMiniPlayer(): React.JSX.Element | null {
  const ctx = usePreviewPlayer();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();

  if (!ctx) return null;
  if (!ctx.state.isPlaying) return null;

  const label = ctx.state.currentLabel ?? 'Preview';
  // Sit above the home indicator and any tab bar (~49 px). Without the
  // offset the capsule overlaps the iOS bottom edge on notched devices.
  const bottom = Math.max(insets.bottom, 8) + 60;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { bottom }]}
      testID="preview-mini-player-host"
    >
      <Pressable
        onPress={() => {
          void ctx.controller.stop();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Stop preview — ${label}`}
        testID="preview-mini-player"
        style={({ pressed }) => [
          styles.capsule,
          {
            backgroundColor: tokens.colors.surface,
            borderColor: tokens.colors.ruleStrong,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <View
          style={[styles.stopGlyph, { backgroundColor: tokens.colors.ink }]}
        />
        <Text
          style={[styles.label, { color: tokens.colors.ink }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '90%',
    // Subtle elevation so the capsule reads as floating above content.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 4,
  },
  stopGlyph: {
    width: 12,
    height: 12,
    borderRadius: RADII.xs,
  },
  label: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },
});
