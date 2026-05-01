/**
 * First-run step 1 of 4 — push notifications permission.
 *
 * Shows a pre-explanation screen, then on Continue triggers the OS permission
 * prompt via expo-notifications. Whether the user grants or denies, we
 * advance to the next step (we re-prompt later from Settings if they denied).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { Bell } from 'lucide-react-native';
import { FirstRunStep, heroTitleStyle } from './_components';
import { useTheme } from '../../../lib/theme';

const TAGS = ['On-sale alerts', 'Tour announcements', 'Doors at 7'];

export default function FirstRunNotifications(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const advance = React.useCallback(() => {
    router.push('/(auth)/first-run/photos');
  }, [router]);

  const onPrimary = React.useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
    } catch {
      // OS prompt failed — still advance so the user isn't stuck.
    } finally {
      setPending(false);
      advance();
    }
  }, [advance, pending]);

  return (
    <FirstRunStep
      step={1}
      total={4}
      eyebrow="STEP 1 OF 4"
      title={
        <Text style={[heroTitleStyle, { color: colors.ink, textAlign: 'center' }]}>
          Don&apos;t miss the <Text style={{ color: colors.accent }}>on-sale.</Text>
        </Text>
      }
      body="Showbook pings you the moment a watched artist announces tour dates or tickets drop. Nothing else — no marketing, no daily digests."
      icon={<Bell size={42} color={colors.accent} strokeWidth={1.75} />}
      iconBg="rgba(217,128,90,0.2)"
      footer={
        <View style={styles.tagRow}>
          {TAGS.map((tag) => (
            <View
              key={tag}
              style={[styles.tagChip, { backgroundColor: colors.surface, borderColor: colors.rule }]}
            >
              <Text style={[styles.tagText, { color: colors.muted }]}>{`✓  ${tag}`}</Text>
            </View>
          ))}
        </View>
      }
      primaryLabel="Turn on notifications"
      onPrimary={onPrimary}
      secondaryLabel="Maybe later"
      onSecondary={advance}
      pending={pending}
    />
  );
}

const styles = StyleSheet.create({
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  tagChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  tagText: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
  },
});
