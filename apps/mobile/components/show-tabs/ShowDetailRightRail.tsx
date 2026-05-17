/**
 * ShowDetailRightRail (iPad) — the persistent right pane on the iPad
 * three-pane shell. In v1 it pins the HypePlaylistCard (pre-show) +
 * FanLoyaltyRing (post-show, once P7 lands). Hidden on phones.
 *
 * The component is intentionally a thin wrapper around the slot props
 * so the SetlistTab can share the same atom instances when needed.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../lib/theme';
import { SectionFrame } from './SectionFrame';

export interface RightRailSlots {
  hypePlaylistCard?: React.ReactNode | null;
  fanLoyaltyRing?: React.ReactNode | null;
}

export interface ShowDetailRightRailProps {
  isPast: boolean;
  slots: RightRailSlots;
}

export function ShowDetailRightRail({
  isPast,
  slots,
}: ShowDetailRightRailProps): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const hasAny = Boolean(slots.hypePlaylistCard || slots.fanLoyaltyRing);
  if (!hasAny) return null;
  return (
    <View
      testID="show-detail-right-rail"
      style={[
        styles.rail,
        { backgroundColor: colors.bg, borderLeftColor: colors.rule },
      ]}
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.eyebrow, { color: colors.muted }]}>
            SETLIST LAB
          </Text>
          <Text style={[styles.title, { color: colors.ink }]}>
            {isPast ? 'After tonight' : 'Tonight'}
          </Text>
        </View>
        {!isPast && slots.hypePlaylistCard ? (
          <SectionFrame title="Hype playlist">
            {slots.hypePlaylistCard}
          </SectionFrame>
        ) : null}
        {isPast && slots.fanLoyaltyRing ? (
          <SectionFrame title="Fan loyalty">
            {slots.fanLoyaltyRing}
          </SectionFrame>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: 360,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  eyebrow: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    letterSpacing: 1.4,
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.6,
    marginTop: 4,
  },
});
