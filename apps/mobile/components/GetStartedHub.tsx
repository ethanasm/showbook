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
 *   - "card" — slim setup checklist above the dashboard once the user has
 *      shows; each step tracks live data (first show / first follow /
 *      home region) and the card retires itself when everything is done.
 *      Dismissible; persistence via expo-secure-store (matches the
 *      existing pattern in lib/theme.ts).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Circle,
  Compass,
  Mail,
  Music,
  Plus,
  X,
} from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { Eyebrow, GlowBackdrop, GradientEmphasis } from './design-system';

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

/**
 * One row of the setup checklist (card variant). Mirrors the web hub's
 * `GetStartedStep` — steps are computed by the Home tab from live
 * queries so the hub stays presentational.
 */
export interface GetStartedStep {
  id: string;
  label: string;
  done: boolean;
  href: string;
}

export function GetStartedHub({
  variant,
  onDismiss,
  steps,
}: {
  variant: Variant;
  onDismiss?: () => void;
  /** Checklist rows for the card variant; ignored by `expanded`. */
  steps?: GetStartedStep[];
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
      subtitle: 'Scan your inbox for ticket confirmations.',
      icon: <Mail size={18} color={colors.accent} />,
      href: '/integrations/gmail',
    },
    {
      id: 'spotify',
      title: 'Follow your Spotify artists',
      subtitle: "Seeds Discover with their announcements — it won't add shows. Manage from the web app.",
      icon: <Music size={18} color={colors.muted} />,
      href: '/integrations/spotify',
    },
  ];

  if (variant === 'card') {
    const checklist = steps ?? [];
    const doneCount = checklist.filter((s) => s.done).length;
    return (
      <View
        testID="get-started-card"
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.rule }]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={[styles.cardEyebrow, { color: colors.faint }]}>GET STARTED</Text>
            {checklist.length > 0 ? (
              <Text
                testID="get-started-progress"
                style={[styles.cardProgress, { color: colors.accent }]}
              >
                {doneCount} of {checklist.length}
              </Text>
            ) : null}
          </View>
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
        <View style={styles.cardSteps}>
          {checklist.map((s) =>
            s.done ? (
              <View
                key={s.id}
                testID={`get-started-step-${s.id}`}
                style={styles.cardStep}
              >
                <Check size={14} color={colors.accent} strokeWidth={2.4} />
                <Text
                  numberOfLines={1}
                  style={[styles.cardStepLabel, { color: colors.muted }]}
                >
                  {s.label}
                </Text>
              </View>
            ) : (
              <Pressable
                key={s.id}
                testID={`get-started-step-${s.id}`}
                onPress={() => router.push(s.href)}
                accessibilityRole="button"
                accessibilityLabel={s.label}
                style={({ pressed }) => [styles.cardStep, pressed && { opacity: 0.6 }]}
              >
                <Circle size={12} color={colors.faint} strokeWidth={2} />
                <Text
                  numberOfLines={1}
                  style={[styles.cardStepLabel, { color: colors.ink }]}
                >
                  {s.label}
                </Text>
                <ChevronRight size={14} color={colors.accent} strokeWidth={2} />
              </Pressable>
            ),
          )}
        </View>
      </View>
    );
  }

  return (
    <View testID="get-started-hub" style={styles.expandedContainer}>
      <GlowBackdrop />
      <View style={styles.expandedHeader}>
        <Eyebrow>GET STARTED</Eyebrow>
        <Text style={[styles.expandedTitle, { color: colors.ink }]}>
          Build your{' '}
          <GradientEmphasis style={[styles.expandedTitle, { color: colors.accent }]}>
            showbook
          </GradientEmphasis>
        </Text>
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
    overflow: 'hidden',
  },
  expandedHeader: {
    alignItems: 'center',
    gap: 6,
  },
  expandedTitle: {
    fontSize: 28,
    fontFamily: 'Fraunces',
    fontWeight: '700',
    letterSpacing: -0.4,
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
    fontFamily: 'Geist Sans 600',
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
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  cardProgress: {
    fontSize: 10,
    fontFamily: 'Geist Mono',
    letterSpacing: 0.6,
  },
  cardSteps: {
    gap: 2,
  },
  cardStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  cardStepLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Geist Sans',
    letterSpacing: 0.1,
  },
});
