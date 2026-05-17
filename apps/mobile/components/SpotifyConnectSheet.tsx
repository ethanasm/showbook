/**
 * SpotifyConnectSheet — mobile mirror of
 * `apps/web/components/spotify/SpotifyConnectModal.tsx`. Bottom-sheet
 * presentation via the existing `Sheet` primitive; same single-button
 * UX (Connect Spotify · Not now). Drives off
 * `apps/mobile/lib/spotify-connection.ts`'s `useSpotifyConnection` hook
 * — render this sheet anywhere a Spotify-using feature is invoked.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Music } from 'lucide-react-native';

import { ExternalSourceDisclaimer } from './ExternalSourceDisclaimer';
import { Sheet } from './Sheet';
import { useTheme } from '../lib/theme';

export interface SpotifyConnectSheetProps {
  open: boolean;
  /** Inline copy explaining what the user is about to do. */
  ctaLabel?: string;
  /** Last error from the connect attempt. */
  error?: string | null;
  /** True while the OAuth in-app browser is open. Disables the connect button. */
  busy?: boolean;
  onConnect: () => void;
  onClose: () => void;
}

export function SpotifyConnectSheet({
  open,
  ctaLabel,
  error,
  busy,
  onConnect,
  onClose,
}: SpotifyConnectSheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['72%']}>
      <View style={styles.container}>
        <View style={styles.iconRow}>
          <Music size={18} color={colors.ink} />
          <Text style={[styles.title, { color: colors.ink, fontFamily: 'Geist Mono' }]}>
            CONNECT SPOTIFY
          </Text>
        </View>

        <Text style={[styles.body, { color: colors.ink, fontFamily: 'Geist Sans' }]}>
          {ctaLabel ??
            "Showbook uses Spotify to make playlists, identify songs, and surface stats about your shows. Connect once and we'll handle the rest."}
        </Text>

        <ExternalSourceDisclaimer source="spotify" />

        <Pressable
          accessibilityRole="button"
          onPress={onConnect}
          disabled={busy}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.accent, opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
          ]}
          testID="spotify-connect-button"
        >
          <Text style={[styles.primaryLabel, { color: colors.bg, fontFamily: 'Geist Mono' }]}>
            {busy ? 'CONNECTING…' : 'CONNECT SPOTIFY'}
          </Text>
        </Pressable>

        {error ? (
          <Text
            accessibilityRole="alert"
            style={[styles.error, { color: '#E63946', fontFamily: 'Geist Mono' }]}
          >
            {error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={styles.secondaryButton}
          testID="spotify-connect-cancel"
        >
          <Text style={[styles.secondaryLabel, { color: colors.muted, fontFamily: 'Geist Mono' }]}>
            NOT NOW
          </Text>
        </Pressable>

        {/* Bottom inset so the safe-area edge doesn't crowd the
            secondary button. The Sheet primitive doesn't add it. */}
        <View style={{ height: 16 }} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 14,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 11,
    letterSpacing: 0.8,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  primaryButton: {
    marginTop: 4,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontSize: 12,
    letterSpacing: 0.7,
  },
  secondaryButton: {
    paddingVertical: 10,
    alignSelf: 'center',
  },
  secondaryLabel: {
    fontSize: 11,
    letterSpacing: 0.7,
  },
  error: {
    fontSize: 11,
    letterSpacing: 0.3,
  },
});
