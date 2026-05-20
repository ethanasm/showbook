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
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { ChevronRight, Ticket } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { hapticImpactMedium, hapticSelection } from '../lib/haptics';
import { useFeedback } from '../lib/feedback';
import { KindBadge } from './KindBadge';
import { StateChip } from './StateChip';
import { RemoteImage } from './design-system/RemoteImage';
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
  /**
   * Optional headliner artwork. When set, a 32pt circular avatar
   * renders between the date block and the content column — the
   * Home tab opts in to add a face to every row; legacy callers
   * (Shows tab, artist/venue detail) leave it unset and look the same.
   */
  avatarUrl?: string | null;
  /**
   * When set on a watching/ticketed row, a Ticket icon button renders
   * before the chevron so the user can jump straight to the listing
   * (Ticketmaster, etc.) without opening the show detail first.
   */
  ticketUrl?: string | null;
}

export interface ShowCardProps {
  show: ShowCardShow;
  onPress?: () => void;
  onLongPress?: () => void;
  compact?: boolean;
}

export function ShowCard({
  show,
  onPress,
  onLongPress,
  compact = false,
}: ShowCardProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { showToast } = useFeedback();

  // Left edge bar color
  const barColor =
    show.state === 'ticketed'
      ? colors.accent
      : show.state === 'watching'
        ? tokens.kindColor(show.kind)
        : colors.rule;

  const showTicketAction =
    Boolean(show.ticketUrl) &&
    (show.state === 'watching' || show.state === 'ticketed');

  return (
    <Pressable
      onPress={onPress}
      onLongPress={
        onLongPress
          ? () => {
              void hapticImpactMedium();
              onLongPress();
            }
          : undefined
      }
      delayLongPress={300}
      style={({ pressed }) => [
        styles.container,
        compact ? styles.compact : styles.card,
        { backgroundColor: compact ? 'transparent' : colors.surface },
        compact && { borderBottomColor: colors.rule },
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

      {/* Optional headliner avatar — opt-in via `show.avatarUrl`. When the
          URL is missing the kind-coloured monogram fallback still renders,
          which is the point: every row gets a face. */}
      {show.avatarUrl !== undefined ? (
        <RemoteImage
          uri={show.avatarUrl}
          name={show.headliner}
          kind={show.kind}
          size="thumb"
          style={styles.avatar}
        />
      ) : null}

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

      {/* Ticketmaster jump — watching/ticketed shows with a ticket URL */}
      {showTicketAction && show.ticketUrl ? (
        <Pressable
          onPress={() => {
            void hapticSelection();
            Linking.openURL(show.ticketUrl as string).catch(() => {
              showToast({ kind: 'error', text: "Couldn't open Ticketmaster." });
            });
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open tickets on Ticketmaster"
          testID={`show-card-tickets-${show.id}`}
          style={({ pressed }) => [
            styles.ticketAction,
            { borderColor: colors.rule, backgroundColor: colors.surface },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Ticket size={14} color={colors.muted} strokeWidth={2} />
        </Pressable>
      ) : null}

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
  avatar: {
    alignSelf: 'center',
    marginRight: 10,
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
  ticketAction: {
    alignSelf: 'center',
    width: 30,
    height: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});
