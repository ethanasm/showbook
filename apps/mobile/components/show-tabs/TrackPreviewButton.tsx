/**
 * TrackPreviewButton (mobile) — 24pt ▶ button that lives in the third
 * column of every setlist row. Mirrors the web `TrackPreview`:
 *
 *  - idle ▶ when a preview URL (or Spotify track id) is already cached
 *  - on tap with neither cached: spins while `resolveTrackPreview`
 *    runs, then plays the resolved URL (or marks the row unavailable)
 *  - active: hairline-thick disc with the controller's playback flag
 *  - disabled (cursor-not-allowed semantics) only when we tried to
 *    resolve and got nothing
 *
 * The `PreviewPlayerProvider` itself lives in
 * `apps/mobile/lib/preview-player-provider.tsx` and is mounted by
 * the root `_layout.tsx` so playback survives navigation between
 * Show / Artist / Song screens.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../../lib/theme';
import { RADII } from '../../lib/theme-utils';
import type { PreviewHandle } from '../../lib/setlist-intel';
import { usePreviewPlayer } from '../../lib/preview-player-provider';
import { trpc } from '../../lib/trpc';

export { PreviewPlayerProvider } from '../../lib/preview-player-provider';

export interface TrackPreviewButtonProps {
  showId: string;
  title: string;
  previewUrl: string | null;
  spotifyTrackId: string | null;
}

export function TrackPreviewButton({
  showId,
  title,
  previewUrl,
  spotifyTrackId,
}: TrackPreviewButtonProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const ctx = usePreviewPlayer();
  const utils = trpc.useUtils();
  const resolveMutation = trpc.setlistIntel.resolveTrackPreview.useMutation();

  const [unavailable, setUnavailable] = React.useState(false);
  // Local override for the cached preview URL — when the resolver
  // returns one mid-session, hold onto it so a second tap on the same
  // row plays immediately without bouncing back through the cache.
  const [resolved, setResolved] = React.useState<{
    previewUrl: string | null;
    spotifyTrackId: string | null;
  } | null>(null);

  const effectivePreviewUrl = resolved?.previewUrl ?? previewUrl;
  const effectiveSpotifyId = resolved?.spotifyTrackId ?? spotifyTrackId;

  const key = `${showId}:${title.toLowerCase()}`;
  const isActive = ctx?.state.currentTrackKey === key;
  const isLoading = ctx?.state.loadingKey === key;

  // When mounted outside a provider (defensive), render a static slot
  // so the row's grid stays aligned.
  if (!ctx) {
    return (
      <View
        testID="track-preview-slot"
        style={[styles.button, { borderColor: colors.rule, opacity: 0.4 }]}
        accessibilityElementsHidden
      />
    );
  }

  const disabled = unavailable;

  const handle: PreviewHandle = {
    key,
    previewUrl: effectivePreviewUrl,
    spotifyTrackId: effectiveSpotifyId,
    label: title,
  };

  const onPress = async () => {
    if (isActive) {
      await ctx.controller.stop();
      return;
    }
    if (disabled) return;

    await ctx.controller.play(handle, {
      resolve: effectivePreviewUrl
        ? undefined
        : async () => {
            const next = await resolveMutation.mutateAsync({
              showId,
              title,
            });
            setResolved(next);
            // Update the cached previews map so other rows for this
            // performer (and a return visit to this show) see the
            // freshly-resolved URL without re-hitting the resolver.
            utils.setlistIntel.trackPreviewsForShow.setData(
              { showId },
              (prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  previews: {
                    ...prev.previews,
                    [title.toLowerCase()]: {
                      previewUrl: next.previewUrl,
                      spotifyTrackId: next.spotifyTrackId,
                    },
                  },
                };
              },
            );
            return next;
          },
      onUnavailable: () => setUnavailable(true),
    });
  };

  return (
    <Pressable
      onPress={() => {
        void onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={
        isActive
          ? 'Stop preview'
          : isLoading
            ? 'Loading preview…'
            : unavailable
              ? 'Preview unavailable'
              : 'Play 30-second preview'
      }
      testID={`track-preview-button-${title.toLowerCase().replace(/\s+/g, '-')}`}
      disabled={disabled && !isActive}
      style={[
        styles.button,
        {
          borderColor: colors.ruleStrong,
          backgroundColor: isActive ? colors.accent : 'transparent',
          opacity: disabled && !isActive ? 0.35 : 1,
        },
      ]}
    >
      {isLoading ? (
        <ActivityIndicator
          size="small"
          color={colors.ink}
          testID="track-preview-spinner"
        />
      ) : (
        <View
          style={[
            styles.glyph,
            {
              borderLeftColor: isActive ? colors.accentText : colors.ink,
            },
          ]}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 24,
    height: 24,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 7,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: 2,
  },
});
