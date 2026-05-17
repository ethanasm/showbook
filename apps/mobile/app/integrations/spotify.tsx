/**
 * Spotify integration manage screen — Phase 10 Part C2. Mirrors the
 * web Preferences → Integrations row: shows "Connect" when not linked,
 * "Connected to {handle}" + Disconnect button when linked. Drives off
 * `useSpotifyConnection` from `apps/mobile/lib/spotify-connection.ts`.
 *
 * The Hype playlist tap on Show detail still presents the
 * `SpotifyConnectSheet` inline; this screen is the operator-style
 * "manage from Preferences" affordance.
 */

import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Music } from 'lucide-react-native';

import { ExternalSourceDisclaimer } from '../../components/ExternalSourceDisclaimer';
import { TopBar } from '../../components/TopBar';
import { SpotifyConnectSheet } from '../../components/SpotifyConnectSheet';
import { OfflineEmptyState } from '../../components/OfflineEmptyState';
import { useTheme } from '../../lib/theme';
import { useNetwork } from '../../lib/network';
import { useSpotifyConnection } from '../../lib/spotify-connection';
import { trpc } from '../../lib/trpc';

export default function SpotifyIntegrationScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const network = useNetwork();
  const utils = trpc.useUtils();

  const {
    connection,
    sheetOpen,
    closeSheet,
    startConnect,
    busy,
    error,
    requireConnection,
  } = useSpotifyConnection();
  const disconnect = trpc.spotify.disconnect.useMutation({
    onSuccess: async () => {
      await utils.spotify.connectionStatus.invalidate();
    },
  });

  const onConnect = React.useCallback(() => {
    void requireConnection(() => undefined);
  }, [requireConnection]);

  const onDisconnect = React.useCallback(() => {
    Alert.alert(
      'Disconnect Spotify',
      'Showbook will stop accessing your Spotify library. You can reconnect any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            void disconnect.mutateAsync();
          },
        },
      ],
    );
  }, [disconnect]);

  const renderBody = (): React.JSX.Element => {
    if (!network.online) {
      // OAuth needs the in-app browser → web callback → custom scheme
      // hop, none of which works offline. Hide the Connect/Disconnect
      // CTAs so the user doesn't tap a button that can't succeed.
      return (
        <OfflineEmptyState
          title="Connect Spotify when online"
          subtitle="The Spotify handshake needs a live connection. Try again when you're back online."
        />
      );
    }
    if (connection.status === 'loading') {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      );
    }
    if (connection.status === 'disconnected') {
      return (
        <View style={styles.body}>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.rule },
            ]}
          >
            <Music size={20} color={colors.ink} />
            <Text style={[styles.title, { color: colors.ink }]}>
              Connect Spotify
            </Text>
            <Text style={[styles.body3, { color: colors.muted }]}>
              Showbook uses Spotify to make playlists, identify songs, and
              surface stats about your shows.
            </Text>
            <ExternalSourceDisclaimer source="spotify" />
            <Pressable
              accessibilityRole="button"
              testID="spotify-connect-primary"
              onPress={onConnect}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: colors.accent,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[styles.primaryLabel, { color: colors.accentText }]}>
                CONNECT SPOTIFY
              </Text>
            </Pressable>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.body}>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          <Music size={20} color={colors.accent} />
          <Text style={[styles.title, { color: colors.ink }]}>
            Connected to{' '}
            {connection.displayName ?? connection.spotifyUserId ?? 'Spotify'}
          </Text>
          {connection.product ? (
            <Text style={[styles.body3, { color: colors.muted }]}>
              Plan · {connection.product}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            testID="spotify-disconnect-primary"
            onPress={onDisconnect}
            disabled={disconnect.isPending}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                borderColor: '#E63946',
                opacity: disconnect.isPending ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.secondaryLabel, { color: '#E63946' }]}>
              {disconnect.isPending ? 'DISCONNECTING…' : 'DISCONNECT'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title="Spotify"
        eyebrow="MANAGE INTEGRATION"
        leading={
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <ChevronLeft size={22} color={colors.ink} />
          </Pressable>
        }
      />
      {renderBody()}
      <SpotifyConnectSheet
        open={sheetOpen}
        ctaLabel="Connect Spotify so Showbook can build playlists and identify songs."
        error={error}
        busy={busy}
        onConnect={() => {
          void startConnect();
        }}
        onClose={closeSheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  card: {
    padding: 20,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  body3: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  primaryLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.7,
  },
  secondaryButton: {
    marginTop: 8,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  secondaryLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.7,
  },
});
