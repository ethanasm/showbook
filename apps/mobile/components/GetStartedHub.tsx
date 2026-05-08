/**
 * GetStartedHub — mobile onboarding affordance for the Home tab.
 *
 * Mirrors the web hub: presents a small grid of doors that point at the
 * different ways a user can seed their library. Mobile doesn't have native
 * Gmail or Spotify import yet (those land on /integrations/[id] stubs that
 * direct users to the web app), so the doors that link there carry copy
 * acknowledging the redirect.
 *
 * Two variants:
 *   - "expanded" — replaces the Home-tab empty state for a brand-new user.
 *   - "card" — slim banner above the dashboard once the user has shows but
 *      no follows yet. Dismissible; persistence via expo-secure-store
 *      (matches the existing pattern in lib/theme.ts).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { ArrowRight, Compass, Mail, Music, Plus, X } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { RADII } from '../lib/theme-utils';

const STORAGE_KEY = 'showbook.get-started.dismissed';

export function useGetStartedDismissed() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((v) => {
        if (!cancelled) setDismissed(v === '1');
      })
      .catch(() => {
        // SecureStore unavailable in tests / dev — treat as not dismissed.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    SecureStore.setItemAsync(STORAGE_KEY, '1').catch(() => {
      // ignore — UI still flips via local state below
    });
    setDismissed(true);
  }, []);

  return { dismissed, dismiss };
}

type Variant = 'expanded' | 'card';

interface Door {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  primary?: boolean;
  href: string;
}

export function GetStartedHub({
  variant,
  onDismiss,
}: {
  variant: Variant;
  onDismiss?: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();

  const doors: Door[] = [
    {
      id: 'add',
      title: 'Add a show',
      subtitle: 'Log one you remember or just bought tickets to.',
      icon: <Plus size={18} color={colors.accent} />,
      primary: true,
      href: '/add',
    },
    {
      id: 'discover',
      title: 'Find in Discover',
      subtitle: 'See announcements from venues and artists you follow.',
      icon: <Compass size={18} color={colors.accent} />,
      href: '/discover',
    },
    {
      id: 'gmail',
      title: 'Import from Gmail',
      subtitle: 'Backfill past shows from receipts (manage from the web app).',
      icon: <Mail size={18} color={colors.muted} />,
      href: '/integrations/gmail',
    },
    {
      id: 'spotify',
      title: 'Import from Spotify',
      subtitle: 'Powers your Discover feed (manage from the web app).',
      icon: <Music size={18} color={colors.muted} />,
      href: '/integrations/spotify',
    },
  ];

  if (variant === 'card') {
    return (
      <View
        testID="get-started-card"
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.rule }]}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.cardEyebrow, { color: colors.faint }]}>GET STARTED</Text>
          {onDismiss ? (
            <Pressable
              onPress={onDismiss}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Dismiss get started"
            >
              <X size={16} color={colors.faint} />
            </Pressable>
          ) : null}
        </View>
        <Text style={[styles.cardSubtitle, { color: colors.muted }]}>
          Backfill past shows, find upcoming events, or seed your follow graph.
        </Text>
        <View style={styles.cardActions}>
          {doors.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => router.push(d.href)}
              style={({ pressed }) => [
                styles.cardChip,
                { borderColor: colors.rule, opacity: pressed ? 0.6 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={d.title}
            >
              {d.icon}
              <Text style={[styles.cardChipLabel, { color: colors.ink }]}>{d.title}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View testID="get-started-hub" style={styles.expandedContainer}>
      <View style={styles.expandedHeader}>
        <Text style={[styles.expandedEyebrow, { color: colors.faint }]}>GET STARTED</Text>
        <Text style={[styles.expandedTitle, { color: colors.ink }]}>Build your showbook</Text>
        <Text style={[styles.expandedSubtitle, { color: colors.muted }]}>
          Pick a door. You can always come back to add more later.
        </Text>
      </View>
      <View style={styles.doorsGrid}>
        {doors.map((d) => (
          <Pressable
            key={d.id}
            testID={`get-started-door-${d.id}`}
            onPress={() => router.push(d.href)}
            style={({ pressed }) => [
              styles.door,
              {
                backgroundColor: d.primary ? colors.surface : 'transparent',
                borderColor: d.primary ? colors.accent : colors.rule,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={d.title}
          >
            <View style={styles.doorHeader}>
              {d.icon}
              <Text style={[styles.doorTitle, { color: colors.ink }]} numberOfLines={1}>
                {d.title}
              </Text>
              <ArrowRight size={14} color={colors.faint} />
            </View>
            <Text style={[styles.doorSubtitle, { color: colors.muted }]}>{d.subtitle}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  expandedContainer: {
    flex: 1,
    padding: 24,
    gap: 24,
    justifyContent: 'center',
  },
  expandedHeader: {
    alignItems: 'center',
    gap: 6,
  },
  expandedEyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    fontFamily: 'Geist Sans',
  },
  expandedTitle: {
    fontSize: 24,
    fontFamily: 'Geist Sans',
    fontWeight: '600',
  },
  expandedSubtitle: {
    fontSize: 13,
    fontFamily: 'Geist Sans',
    textAlign: 'center',
    lineHeight: 18,
  },
  doorsGrid: {
    gap: 10,
  },
  door: {
    borderWidth: 1,
    borderRadius: RADII.md,
    padding: 14,
    gap: 6,
  },
  doorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  doorTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Geist Sans',
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  doorSubtitle: {
    fontSize: 12,
    fontFamily: 'Geist Sans',
    lineHeight: 16,
  },
  card: {
    borderWidth: 1,
    borderRadius: RADII.md,
    padding: 12,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardEyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    fontFamily: 'Geist Sans',
  },
  cardSubtitle: {
    fontSize: 12,
    fontFamily: 'Geist Sans',
    lineHeight: 16,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  cardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: RADII.sm,
  },
  cardChipLabel: {
    fontSize: 11,
    fontFamily: 'Geist Sans',
    letterSpacing: 0.3,
  },
});
