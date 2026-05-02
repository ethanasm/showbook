/**
 * Cold-launch full-screen offline state.
 *
 * Rendered by `app/index.tsx` when the app boots without a network and
 * without a usable cache snapshot — the normal redirects to (auth) or
 * (tabs) would otherwise produce a blank shell.
 *
 * The screen is intentionally minimal: an icon, a one-line title, a
 * subtitle, and a Retry CTA that re-invokes the parent's retry callback.
 * No router navigation here — the reconnect handler lives at the layout
 * level so this screen just tells the user what's going on.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { WifiOff, RefreshCw } from 'lucide-react-native';

import { useTheme } from '../lib/theme';
import { useNetwork } from '../lib/network';
import { RADII } from '../lib/theme-utils';

export interface OfflineScreenProps {
  /** Optional retry handler — pulled by the index gate when present. */
  onRetry?: () => void;
}

export default function OfflineScreen({ onRetry }: OfflineScreenProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { lastSeenOnline } = useNetwork();

  const lastSeenText = lastSeenOnline
    ? `Last online ${formatRelative(lastSeenOnline)}`
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.iconWrap}>
        <WifiOff size={56} color={colors.muted} strokeWidth={1.5} />
      </View>
      <Text style={[styles.title, { color: colors.ink }]}>You’re offline</Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>
        Showbook needs a connection to load your shows. We’ll pick up where you
        left off as soon as you’re back.
      </Text>
      {lastSeenText ? (
        <Text style={[styles.meta, { color: colors.faint }]}>{lastSeenText}</Text>
      ) : null}
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: colors.accent },
            pressed && styles.pressed,
          ]}
        >
          <RefreshCw size={16} color={colors.accentText} strokeWidth={2} />
          <Text style={[styles.ctaLabel, { color: colors.accentText }]}>
            Try again
          </Text>
        </Pressable>
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
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  iconWrap: {
    opacity: 0.5,
    marginBottom: 8,
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  meta: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  cta: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: RADII.pill,
  },
  ctaLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
});
