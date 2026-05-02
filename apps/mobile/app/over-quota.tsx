/**
 * Over-quota state — `/over-quota`.
 *
 * Full-screen takeover the upload pipeline routes to when any file's
 * intent / PUT / confirm step surfaces an `OverQuotaError`. The CTA links
 * to a stub "Manage storage" route — the actual storage manager is
 * out-of-scope for M4 (server quotas; user can already delete media from
 * the lightbox / show detail).
 *
 * Reads the user's current quota usage so the copy can reflect "you're at
 * 4.9 GB of 5 GB" rather than just a generic refusal.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, AlertCircle } from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import { useTheme } from '../lib/theme';
import { trpc } from '../lib/trpc';
import { CACHE_DEFAULTS } from '../lib/cache';
import { RADII } from '../lib/theme-utils';

function formatGigabytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

export default function OverQuotaScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const quota = trpc.media.getQuota.useQuery(undefined, {
    staleTime: CACHE_DEFAULTS.staleTime,
    gcTime: CACHE_DEFAULTS.gcTime,
  });

  const usage = quota.data
    ? `${formatGigabytes(quota.data.used.userBytes)} of ${formatGigabytes(
        quota.data.limits.userBytes,
      )} used`
    : null;

  const back = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Storage full" eyebrow="MEDIA" leading={back} />

      <View style={styles.body}>
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          <AlertCircle size={28} color={colors.danger} strokeWidth={1.8} />
        </View>

        <Text style={[styles.title, { color: colors.ink }]}>You&rsquo;re out of media storage.</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          We couldn&rsquo;t finish uploading. Free up space by removing photos or videos from
          earlier shows, or upgrade your plan to keep adding memories.
        </Text>

        <View style={[styles.usageCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
          {quota.isLoading ? (
            <ActivityIndicator color={colors.muted} />
          ) : usage ? (
            <>
              <Text style={[styles.usageLabel, { color: colors.faint }]}>USAGE</Text>
              <Text style={[styles.usageValue, { color: colors.ink }]}>{usage}</Text>
            </>
          ) : (
            <Text style={[styles.usageLabel, { color: colors.faint }]}>
              QUOTA UNAVAILABLE
            </Text>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage storage"
          onPress={() => router.push('/(tabs)/me')}
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: colors.accent },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={[styles.primaryLabel, { color: colors.accentText }]}>Manage storage</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={[styles.secondaryLabel, { color: colors.muted }]}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 36,
    alignItems: 'stretch',
    gap: 14,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 26,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  subtitle: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  usageCard: {
    marginTop: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: RADII.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  usageLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.2,
  },
  usageValue: {
    fontFamily: 'Geist Sans',
    fontSize: 16,
    fontWeight: '600',
  },
  primaryBtn: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
  },
});
