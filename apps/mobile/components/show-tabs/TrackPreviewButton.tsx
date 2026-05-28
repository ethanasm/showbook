/**
 * TrackPreviewButton (mobile) — 24pt ▶ button that lives in the third
 * column of every setlist row. Mirrors the web `TrackPreview`, with one
 * key divergence: when the resolver returns a `spotify_track_id` but no
 * 30-second `preview_url` (the common post-deprecation case), the tap
 * hands off to the Spotify app via `spotify:track:<id>` instead of
 * silently marking the row unavailable. See
 * `lib/setlist-intel/spotify-deep-link.ts` for the open-plan helper.
 *
 *  - idle ▶ when a preview URL (or Spotify track id) is already cached
 *  - on tap with preview URL → plays the 30-second clip inline
 *  - on tap with only a track id → opens the track in the Spotify app
 *    (falls back to `open.spotify.com` when the app isn't installed)
 *  - on tap with neither cached: spins while `resolveTrackPreview`
 *    runs, then routes to one of the two branches above (or marks
 *    unavailable when both come back null)
 *  - active: hairline-thick disc with the controller's playback flag —
 *    only set when in-app preview is playing; deep-link taps leave the
 *    button idle since the user is now in Spotify
 *  - disabled only when both `preview_url` and `spotify_track_id` are
 *    confirmed null (either resolver short-circuit OR no Spotify match
 *    found at resolve time)
 *
 * The `PreviewPlayerProvider` itself lives in
 * `apps/mobile/lib/preview-player-provider.tsx` and is mounted by
 * the root `_layout.tsx` so playback survives navigation between
 * Show / Artist / Song screens.
 */

import React from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import {
  buildSpotifyTrackOpenPlan,
  type PreviewHandle,
} from '@/lib/setlist-intel';
import { usePreviewPlayer } from '@/lib/preview-player-provider';
import { trpc } from '@/lib/trpc';

export { PreviewPlayerProvider } from '@/lib/preview-player-provider';

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
  const [resolving, setResolving] = React.useState(false);
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
  const isLoading = ctx?.state.loadingKey === key || resolving;

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

  // Hand off a `spotify_track_id` to the Spotify app via the
  // native deep-link, falling back to `open.spotify.com` in
  // the in-app browser when the app isn't installed. Mirrors the
  // pattern in `HypePlaylistCard.openExisting` — don't gate on
  // `canOpenURL` (silently misroutes when the scheme isn't declared);
  // try `openURL(primary)` and fall through on rejection.
  const openInSpotify = async (trackId: string): Promise<boolean> => {
    const plan = buildSpotifyTrackOpenPlan(trackId);
    if (!plan) return false;
    try {
      await Linking.openURL(plan.primary);
      return true;
    } catch {
      // Spotify app not installed — fall through to the web URL.
    }
    try {
      await WebBrowser.openBrowserAsync(plan.fallback);
      return true;
    } catch {
      try {
        await Linking.openURL(plan.fallback);
        return true;
      } catch {
        return false;
      }
    }
  };

  const cacheResolved = (next: {
    previewUrl: string | null;
    spotifyTrackId: string | null;
  }) => {
    setResolved(next);
    // Update the cached previews map so other rows for this
    // performer (and a return visit to this show) see the
    // freshly-resolved values without re-hitting the resolver.
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
  };

  const playPreview = async (handlePreviewUrl: string, trackId: string | null) => {
    const handle: PreviewHandle = {
      key,
      previewUrl: handlePreviewUrl,
      spotifyTrackId: trackId,
      label: title,
    };
    await ctx.controller.play(handle, {
      onUnavailable: () => setUnavailable(true),
    });
  };

  // Try the full-track SDK if available + track id known. Returns true
  // on success (Spotify is now playing in-app) so the caller can skip
  // the preview / deep-link fallbacks. Mirrors web's `FullTrackDriver`
  // call site at `apps/web/lib/preview-player.tsx:200`.
  const tryFullTrack = async (trackId: string): Promise<boolean> => {
    if (!ctx.controller.hasFullTrackDriver()) return false;
    try {
      await ctx.controller.playFullTrack(trackId);
      return true;
    } catch {
      return false;
    }
  };

  const onPress = async () => {
    if (isActive) {
      await ctx.controller.stop();
      return;
    }
    if (disabled) return;

    // Fast paths: route immediately when something is cached. Fallback
    // chain is SDK (Premium full-track) → preview URL (30s clip) →
    // deep-link (Spotify app handoff for any other state with a known
    // track id). `unavailable` is only set when every branch fails.
    if (effectiveSpotifyId && (await tryFullTrack(effectiveSpotifyId))) {
      return;
    }
    if (effectivePreviewUrl) {
      await playPreview(effectivePreviewUrl, effectiveSpotifyId);
      return;
    }
    if (effectiveSpotifyId) {
      const opened = await openInSpotify(effectiveSpotifyId);
      if (!opened) setUnavailable(true);
      return;
    }

    // Cold path: nothing cached. Run the resolver, then route.
    setResolving(true);
    try {
      const next = await resolveMutation.mutateAsync({ showId, title });
      cacheResolved(next);
      if (next.spotifyTrackId && (await tryFullTrack(next.spotifyTrackId))) {
        return;
      }
      if (next.previewUrl) {
        await playPreview(next.previewUrl, next.spotifyTrackId);
        return;
      }
      if (next.spotifyTrackId) {
        const opened = await openInSpotify(next.spotifyTrackId);
        if (!opened) setUnavailable(true);
        return;
      }
      setUnavailable(true);
    } catch {
      setUnavailable(true);
    } finally {
      setResolving(false);
    }
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
