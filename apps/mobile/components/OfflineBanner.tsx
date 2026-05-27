/**
 * OfflineBanner — small, persistent, non-dismissable status strip shown at
 * the top of the screen whenever `useNetwork().online` is false.
 *
 * Renders absolute above content (same z-layer as `BannerHost`) so it
 * doesn't push screens' TopBars below the fold. Intentionally has no
 * dismiss affordance — it's a status indicator, not a notification.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WifiOff } from 'lucide-react-native';

import { useTheme } from '@/lib/theme';
import { useNetwork } from '@/lib/network';

export function OfflineBanner(): React.JSX.Element | null {
  const { online } = useNetwork();
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();

  if (online) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: insets.top }]}
    >
      <View
        accessibilityRole="alert"
        accessibilityLabel="Offline mode"
        style={[
          styles.banner,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.ruleStrong,
          },
        ]}
      >
        <WifiOff size={13} color={colors.muted} strokeWidth={2} />
        <Text
          style={[
            styles.label,
            { color: colors.ink },
          ]}
        >
          You&apos;re offline
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 998,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  label: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '600',
  },
});
