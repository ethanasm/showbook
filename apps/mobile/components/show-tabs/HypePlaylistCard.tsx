/**
 * HypePlaylistCard (mobile) — single-row compact card. The whole card is
 * the tap target; no fake album-art tile, no separate CTA button below.
 *
 * Behavior parity with web:
 *  - First tap without a Spotify connection slides up the
 *    `SpotifyConnectSheet` and resumes the action on success.
 *  - When an existing playlist row exists, tapping hands off to the
 *    native Spotify app via `spotify://playlist/{id}` when installed;
 *    falls back to the in-app browser on the web URL.
 *  - SI-05 hide rule (rotating / improvised pre-show) is enforced at
 *    the caller — `pickSetlistView` + `shouldRenderHypePlaylistCard`
 *    already gate this card out of the layout.
 */

import React from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';

import { useTheme } from '../../lib/theme';
import { SpotifyMark } from '../BrandIcons';
import { RADII } from '../../lib/theme-utils';
import { hapticSuccess } from '../../lib/haptics';
import { trpc } from '../../lib/trpc';
import { useNetwork } from '../../lib/network';
import { useSpotifyConnection } from '../../lib/spotify-connection';
import { SpotifyConnectSheet } from '../SpotifyConnectSheet';
import { buildSpotifyOpenPlan } from '../../lib/setlist-intel';
import { useQueryClient } from '@tanstack/react-query';
import { runOptimisticMutation } from '../../lib/mutations';
import { getCacheOutbox } from '../../lib/cache/db';

export interface HypePlaylistCardProps {
  showId: string;
  /** Performer whose songs the playlist is built from — the festival
   *  Setlist tab passes the chip-rail selection so each lineup
   *  artist gets its own playlist row; single-artist concerts pass
   *  the headliner. */
  performerId: string;
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
  /** Internal sentinel — set when the create is queued in the outbox while
   *  offline so the UI shows "Will create when online" instead of the
   *  Create CTA. Cleared on reconcile. */
  pending?: boolean;
}

export function HypePlaylistCard({
  showId,
  performerId,
  artist,
  kind,
  trackCount,
  approxMinutes,
}: HypePlaylistCardProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const network = useNetwork();

  const existingQuery = trpc.spotify.existingPlaylist.useQuery({
    showId,
    kind,
    performerId,
  });
  const existing = (existingQuery.data ?? null) as PlaylistRow | null;

  const {
    requireConnection,
    sheetOpen,
    closeSheet,
    startConnect,
    busy: connectBusy,
    error: connectError,
  } = useSpotifyConnection();

  const [statusMsg, setStatusMsg] = React.useState<string | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);

  const isQueued = existing?.pending === true;
  const hasPlaylist = Boolean(existing && existing.spotifyUrl);
  const headlineText = hasPlaylist
    ? kind === 'hype'
      ? 'Open hype playlist'
      : 'Open in Spotify'
    : kind === 'hype'
      ? `Spin up ${trackCount} song${trackCount === 1 ? '' : 's'} you'll hear`
      : `Save ${trackCount} song${trackCount === 1 ? '' : 's'} to Spotify`;
  const subCopy = isQueued
    ? "Queued — we'll create it when you're back online"
    : approxMinutes != null
      ? `~${approxMinutes} min · in show order`
      : 'In show order';

  const performCreate = React.useCallback(async () => {
    setStatusMsg(null);
    setIsCreating(true);
    // Optimistic sentinel: cache a `pending: true` PlaylistRow so the card
    // immediately flips to the "Will create when online" state and the user
    // doesn't double-tap. Reconcile invalidates the query to fetch the real
    // Spotify URL.
    const existingKey = [
      ['spotify', 'existingPlaylist'],
      { input: { showId, kind, performerId }, type: 'query' },
    ];
    type Cache = PlaylistRow | null | undefined;
    const sentinel: PlaylistRow = {
      playlistId: 'pending',
      spotifyUrl: '',
      trackCount: 0,
      durationMs: 0,
      pending: true,
    };
    try {
      const mutationKind =
        kind === 'hype' ? 'spotify.createHypePlaylist' : 'spotify.createHeardPlaylist';
      type CreateResult = {
        missing: unknown[];
        trackCount: number;
        requested: number;
      };
      const { result } = await runOptimisticMutation<
        { showId: string; performerId: string },
        Cache,
        CreateResult
      >({
        mutation: mutationKind,
        input: { showId, performerId },
        outbox: getCacheOutbox(),
        call: (input) =>
          (kind === 'hype'
            ? utils.client.spotify.createHypePlaylist.mutate(input)
            : utils.client.spotify.createHeardPlaylist.mutate(input)) as Promise<CreateResult>,
        optimistic: {
          snapshot: () => queryClient.getQueryData<Cache>(existingKey),
          apply: () => {
            queryClient.setQueryData<Cache>(existingKey, sentinel);
          },
          rollback: (snap) => {
            queryClient.setQueryData<Cache>(existingKey, snap);
          },
        },
        reconcile: () => {
          void utils.spotify.existingPlaylist.invalidate({ showId, kind, performerId });
        },
      });
      const missing = result.missing.length;
      const made = result.trackCount;
      void hapticSuccess();
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
      // Offline / 5xx — the row is in the outbox, so this isn't lost.
      if (!network.online) {
        setStatusMsg("Queued — we'll create it on Spotify when you're back online.");
        return;
      }
      setStatusMsg('Spotify export failed. Try again in a moment.');
    } finally {
      setIsCreating(false);
    }
  }, [kind, network.online, performerId, queryClient, showId, utils]);

  const openExisting = React.useCallback(async () => {
    if (!existing) return;
    const plan = buildSpotifyOpenPlan(existing.spotifyUrl);
    // Try the native deep link directly rather than gating on
    // `Linking.canOpenURL`. `canOpenURL` only returns true when the
    // scheme is declared up front — `LSApplicationQueriesSchemes` on
    // iOS, a `<queries>` element on Android 11+ — and a missing
    // declaration silently sent every tap to the in-app browser even
    // when the Spotify app was installed. `openURL` rejects when no
    // handler is registered, which is exactly the signal we need to
    // fall back to the web URL.
    if (plan.primary && plan.primary !== plan.fallback) {
      try {
        await Linking.openURL(plan.primary);
        return;
      } catch {
        // Spotify app not installed — fall through to the web URL.
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
    if (isQueued) return;
    if (existing && existing.spotifyUrl) {
      await openExisting();
      return;
    }
    await requireConnection(performCreate);
  }, [existing, isQueued, openExisting, performCreate, requireConnection]);

  const trailing = (() => {
    if (isCreating) {
      return <ActivityIndicator size="small" color={colors.accentText} />;
    }
    if (isQueued) return null;
    return <ChevronRight size={18} color={colors.accentText} strokeWidth={2.25} />;
  })();

  const cardOpacity = isQueued ? 0.7 : 1;

  return (
    <View testID={`hype-playlist-card-${kind}`}>
      <Pressable
        testID={`hype-card-${kind}-primary`}
        accessibilityRole="button"
        accessibilityLabel={headlineText}
        onPress={() => {
          void handlePrimaryPress();
        }}
        disabled={isCreating || isQueued}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: colors.accent,
            opacity: pressed ? 0.88 : cardOpacity,
          },
        ]}
      >
        <View style={[styles.iconCircle, { backgroundColor: colors.accentText }]}>
          <SpotifyMark size={18} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.headline, { color: colors.accentText }]} numberOfLines={1}>
            {headlineText}
          </Text>
          <Text style={[styles.sub, { color: colors.accentText }]} numberOfLines={1}>
            {subCopy}
          </Text>
        </View>
        {trailing}
      </Pressable>
      {statusMsg ? (
        <Text
          testID={`hype-card-${kind}-status`}
          style={[styles.status, { color: colors.muted }]}
        >
          {isCreating ? 'Building playlist on Spotify…' : statusMsg}
        </Text>
      ) : null}
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
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADII.pill,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  headline: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  sub: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.3,
    marginTop: 1,
    opacity: 0.72,
  },
  status: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
    marginTop: 8,
    marginHorizontal: 20,
    textAlign: 'center',
  },
});
