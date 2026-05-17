/**
 * HypePlaylistCard (mobile) — Phase 10 Part B4 port of the web
 * `apps/web/components/show-tabs/HypePlaylistCard.tsx`.
 *
 * Behavior parity:
 *  - Branded cover at left + headline copy / two CTAs on the right.
 *  - First tap without a Spotify connection slides up the
 *    `SpotifyConnectSheet` and resumes the action on success.
 *  - When an existing playlist row exists, tapping "Open in Spotify"
 *    hands off to the native Spotify app via `spotify://playlist/{id}`
 *    when installed; falls back to the in-app browser on the web URL.
 *  - SI-05 hide rule (rotating / improvised pre-show) is enforced at
 *    the caller — `pickSetlistView` + `shouldRenderHypePlaylistCard`
 *    already gate this card out of the layout.
 */

import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Music } from 'lucide-react-native';

import { useTheme } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { useSpotifyConnection } from '../../lib/spotify-connection';
import { SpotifyConnectSheet } from '../SpotifyConnectSheet';
import { buildSpotifyOpenPlan } from '../../lib/setlist-intel';

export interface HypePlaylistCardProps {
  showId: string;
  artist: string;
  kind: 'hype' | 'heard';
  trackCount: number;
  approxMinutes: number | null;
}

interface PlaylistRow {
  playlistId: string;
  spotifyUrl: string;
  trackCount: number;
  durationMs: number;
}

export function HypePlaylistCard({
  showId,
  artist,
  kind,
  trackCount,
  approxMinutes,
}: HypePlaylistCardProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const utils = trpc.useUtils();

  const existingQuery = trpc.spotify.existingPlaylist.useQuery({
    showId,
    kind,
  });
  const existing = (existingQuery.data ?? null) as PlaylistRow | null;

  const createHype = trpc.spotify.createHypePlaylist.useMutation({
    onSuccess: () => {
      void utils.spotify.existingPlaylist.invalidate({ showId, kind });
    },
  });
  const createHeard = trpc.spotify.createHeardPlaylist.useMutation({
    onSuccess: () => {
      void utils.spotify.existingPlaylist.invalidate({ showId, kind });
    },
  });

  const {
    requireConnection,
    sheetOpen,
    closeSheet,
    startConnect,
    busy: connectBusy,
    error: connectError,
  } = useSpotifyConnection();

  const [statusMsg, setStatusMsg] = React.useState<string | null>(null);

  const isCreating = createHype.isPending || createHeard.isPending;
  const kickerLabel = kind === 'hype' ? 'HYPE PLAYLIST' : `I HEARD ${artist.toUpperCase()}`;
  const headlineText =
    kind === 'hype'
      ? `Spin up ${trackCount} song${trackCount === 1 ? '' : 's'} you'll hear`
      : `Save ${trackCount} song${trackCount === 1 ? '' : 's'} to Spotify`;
  const subCopy =
    approxMinutes != null
      ? `~${approxMinutes} min · in show order · drops onto your Spotify`
      : 'In show order · drops onto your Spotify';

  const performCreate = React.useCallback(async () => {
    setStatusMsg(null);
    try {
      const result =
        kind === 'hype'
          ? await createHype.mutateAsync({ showId })
          : await createHeard.mutateAsync({ showId });
      const missing = result.missing.length;
      const made = result.trackCount;
      setStatusMsg(
        missing > 0
          ? `Created — ${made} of ${result.requested} resolved`
          : `Created — ${made} song${made === 1 ? '' : 's'} on Spotify`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      if (msg.includes('spotify_scopes_missing:')) {
        setStatusMsg(
          'Spotify needs an updated permission. Reconnect from Preferences.',
        );
        return;
      }
      if (msg.includes('spotify_not_connected')) {
        setStatusMsg('Connect Spotify to create this playlist.');
        return;
      }
      if (msg.includes('prediction_cold') || msg.includes('prediction_empty')) {
        setStatusMsg('Not enough setlist data yet — try again closer to the show.');
        return;
      }
      if (msg.includes('setlist_empty')) {
        setStatusMsg('No setlist on file yet — add songs from the Edit panel.');
        return;
      }
      setStatusMsg('Spotify export failed. Try again in a moment.');
    }
  }, [createHeard, createHype, kind, showId]);

  const openExisting = React.useCallback(async () => {
    if (!existing) return;
    const plan = buildSpotifyOpenPlan(existing.spotifyUrl);
    if (plan.primary && plan.primary !== plan.fallback) {
      try {
        const canOpen = await Linking.canOpenURL(plan.primary);
        if (canOpen) {
          await Linking.openURL(plan.primary);
          return;
        }
      } catch {
        // Fall through to the web URL.
      }
    }
    if (plan.fallback) {
      try {
        await WebBrowser.openBrowserAsync(plan.fallback);
      } catch {
        await Linking.openURL(plan.fallback);
      }
    }
  }, [existing]);

  const handlePrimaryPress = React.useCallback(async () => {
    if (existing) {
      await openExisting();
      return;
    }
    await requireConnection(performCreate);
  }, [existing, openExisting, performCreate, requireConnection]);

  const ctaLabel = existing
    ? 'Open in Spotify'
    : isCreating
      ? 'Working…'
      : kind === 'hype'
        ? 'Open in Spotify'
        : 'Save to Spotify';

  return (
    <View testID={`hype-playlist-card-${kind}`}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.rule,
            borderLeftColor: colors.accent,
          },
        ]}
      >
        <View
          style={[
            styles.cover,
            { backgroundColor: colors.ink },
          ]}
          accessibilityElementsHidden
        >
          <Text style={[styles.coverBrand, { color: colors.accent }]}>
            SHOWBOOK
          </Text>
          <Text style={[styles.coverTitle, { color: colors.bg }]}>
            {kind === 'hype' ? 'hype' : 'heard'}{'\n'}
            {artist.toLowerCase().split(' ')[0] ?? ''}
          </Text>
          <View style={[styles.coverBar, { backgroundColor: colors.accent }]} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.kicker, { color: colors.muted }]}>
            {kickerLabel}
          </Text>
          <Text style={[styles.headline, { color: colors.ink }]}>
            {headlineText}
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{subCopy}</Text>
          <View style={styles.buttonRow}>
            <Pressable
              testID={`hype-card-${kind}-primary`}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
              onPress={() => {
                void handlePrimaryPress();
              }}
              disabled={isCreating}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: colors.accent,
                  opacity: isCreating ? 0.6 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <Music size={12} color={colors.accentText} />
              <Text style={[styles.primaryLabel, { color: colors.accentText }]}>
                {ctaLabel}
              </Text>
            </Pressable>
          </View>
          {statusMsg ? (
            <Text
              testID={`hype-card-${kind}-status`}
              style={[styles.status, { color: colors.muted }]}
            >
              {isCreating ? 'Building playlist on Spotify…' : statusMsg}
            </Text>
          ) : null}
        </View>
      </View>
      <SpotifyConnectSheet
        open={sheetOpen}
        ctaLabel={
          kind === 'hype'
            ? `Connect Spotify to spin up the hype playlist for ${artist}.`
            : `Connect Spotify to save tonight's setlist.`
        }
        error={connectError}
        busy={connectBusy}
        onConnect={() => {
          void startConnect();
        }}
        onClose={closeSheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    flexDirection: 'row',
    gap: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 2,
    overflow: 'hidden',
  },
  cover: {
    width: 96,
    paddingHorizontal: 10,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  coverBrand: {
    fontFamily: 'Geist Mono',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.4,
  },
  coverTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 22,
    letterSpacing: -0.6,
  },
  coverBar: {
    height: 3,
    width: 32,
  },
  body: {
    flex: 1,
    padding: 14,
    gap: 4,
  },
  kicker: {
    fontFamily: 'Geist Mono',
    fontSize: 9,
    letterSpacing: 1.2,
    fontWeight: '500',
  },
  headline: {
    fontFamily: 'Geist Sans',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.3,
    lineHeight: 21,
    marginTop: 2,
  },
  sub: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.3,
    lineHeight: 14,
  },
  buttonRow: {
    marginTop: 10,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  primaryLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  status: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    letterSpacing: 0.3,
    marginTop: 6,
  },
});
