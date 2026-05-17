/**
 * OfflineEmptyState — placeholder shown on tabs that need a live connection
 * (Discover, Search, Spotify integrations). Composes the shared `EmptyState`
 * primitive with the WifiOff icon and an optional "Last online …" line
 * driven by `useNetwork().lastSeenOnline`.
 *
 * Screens render this inside their normal layout (TopBar + body) so the
 * back affordance and tab bar are still reachable while offline.
 */

import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { WifiOff } from 'lucide-react-native';

import { EmptyState } from './EmptyState';
import { useTheme } from '../lib/theme';
import { useNetwork } from '../lib/network';

export interface OfflineEmptyStateProps {
  title?: string;
  subtitle?: string;
}

export function OfflineEmptyState({
  title = "You're offline",
  subtitle = "This view needs a connection. Try again when you're back online.",
}: OfflineEmptyStateProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { lastSeenOnline } = useNetwork();
  const lastOnlineLabel = lastSeenOnline ? formatRelative(lastSeenOnline) : null;

  return (
    <View style={styles.wrap}>
      <EmptyState
        icon={<WifiOff size={40} color={colors.faint} strokeWidth={1.5} />}
        title={title}
        subtitle={subtitle}
      />
      {lastOnlineLabel ? (
        <Text style={[styles.lastOnline, { color: colors.faint }]}>
          Last online {lastOnlineLabel}
        </Text>
      ) : null}
    </View>
  );
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastOnline: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.5,
    marginTop: -16,
    paddingBottom: 24,
  },
});
