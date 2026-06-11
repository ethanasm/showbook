/**
 * TicketStatusHint — one-time hint under the Add form's date field for
 * future-dated shows. The watching → ticketed flip is driven by seat /
 * price (see `shows.create`'s state derivation), which nothing else on
 * the form explains — without this, users save an upcoming show, skip
 * More details, and wonder why it says "watching".
 *
 * Mirrors the web Add page's hint (`showbook:hint:ticket-status` in
 * localStorage); here the dismissal persists via expo-secure-store,
 * matching the GetStartedHub pattern.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useTheme } from '@/lib/theme';

const STORAGE_KEY = 'showbook.hint.ticket-status';

export function TicketStatusHint(): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  // null = still reading storage; render nothing until resolved so the
  // hint never flashes for users who already dismissed it.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((v) => {
        if (!cancelled) setDismissed(v === '1');
      })
      .catch(() => {
        if (!cancelled) setDismissed(false);
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

  if (dismissed !== false) return null;

  return (
    <View
      testID="ticket-status-hint"
      style={[
        styles.wrap,
        { backgroundColor: colors.surface, borderLeftColor: colors.accent },
      ]}
    >
      <Text style={[styles.body, { color: colors.muted }]}>
        Future shows save as{' '}
        <Text style={{ color: colors.ink }}>watching</Text> until they have a
        seat or price (under More details) — then they flip to{' '}
        <Text style={{ color: colors.ink }}>ticketed</Text>.
      </Text>
      <Pressable
        onPress={dismiss}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Dismiss hint"
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        <Text style={[styles.dismiss, { color: colors.accent }]}>GOT IT</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderLeftWidth: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  body: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 12,
    lineHeight: 17,
  },
  dismiss: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    letterSpacing: 0.8,
    paddingTop: 2,
  },
});
