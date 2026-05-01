/**
 * ShowCard — primary list-row component for showing a show entry.
 *
 * Design notes:
 * - Headliner uses Geist Sans (sans-serif), NOT Georgia. Confirmed in design
 *   source: fontFamily "'Geist', system-ui, sans-serif". Georgia is reserved
 *   for heroTitle/headliner type on detail screens.
 * - 3px left edge bar encodes state:
 *     ticketed → accent (gold)
 *     watching → kindColor
 *     past/wishlist → rule (subtle)
 * - compact mode: no surface bg, no card padding, just row + bottom border rule
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { KindBadge } from './KindBadge';
import { StateChip } from './StateChip';
import type { Kind, ShowState } from '../lib/theme';

export interface ShowCardShow {
  id: string;
  kind: Kind;
  state: ShowState;
  headliner: string;
  venue: string;
  city?: string | null;
  month: string; // e.g. 'AUG'
  day: string; // e.g. '15'
  dow: string; // e.g. 'FRI'
  seat?: string | null;
  price?: string | null;
}

export interface ShowCardProps {
  show: ShowCardShow;
  onPress?: () => void;
  compact?: boolean;
}

export function ShowCard({ show, onPress, compact = false }: ShowCardProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  // Left edge bar color
  const barColor =
    show.state === 'ticketed'
      ? colors.accent
      : show.state === 'watching'
        ? tokens.kindColor(show.kind)
        : colors.rule;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        compact ? styles.compact : styles.card,
        { backgroundColor: compact ? 'transparent' : colors.surface },
        pressed && styles.pressed,
      ]}
    >
      {/* 3px left edge state bar */}
      <View style={[styles.stateBar, { backgroundColor: barColor }]} />

      {/* Date block — 44pt min width */}
      <View style={styles.dateBlock}>
        <Text style={[styles.dateMonth, { color: colors.muted }]}>{show.month}</Text>
        <Text style={[styles.dateDay, { color: colors.ink }]}>{show.day}</Text>
        <Text style={[styles.dateDow, { color: colors.faint }]}>{show.dow}</Text>
      </View>

      {/* Content column */}
      <View style={styles.content}>
        {/* Badges row */}
        <View style={styles.badgeRow}>
          <KindBadge kind={show.kind} size="sm" />
          {show.state !== 'past' && <StateChip state={show.state} />}
        </View>

        {/* Headliner — Geist Sans (sans), NOT Georgia */}
        <Text
          style={[styles.headliner, { color: colors.ink }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {show.headliner}
        </Text>

        {/* Venue · city */}
        <Text
          style={[styles.venue, { color: colors.muted }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {show.venue}
          {show.city ? ` · ${show.city}` : ''}
        </Text>
      </View>

      {/* Chevron */}
      <View style={styles.chevronContainer}>
        <ChevronRight size={16} color={colors.faint} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  card: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingRight: 12,
  },
  compact: {
    paddingVertical: 12,
    paddingRight: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(245,245,243,0.10)', // rule — static fallback; dynamic per useTheme above
  },
  pressed: {
    opacity: 0.85,
  },
  stateBar: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginRight: 12,
  },
  dateBlock: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: 12,
  },
  dateMonth: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 11 * 0.05,
  },
  dateDay: {
    fontFamily: 'Geist Sans',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
  },
  dateDow: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '400',
    textTransform: 'uppercase',
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'nowrap',
  },
  headliner: {
    fontFamily: 'Geist Sans', // sans-serif per design source — NOT Georgia
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
  },
  venue: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  chevronContainer: {
    justifyContent: 'center',
    paddingLeft: 8,
  },
});
