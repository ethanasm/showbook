/**
 * ShowCard — primary list-row component for showing a show entry.
 *
 * Design notes:
 * - Headliner uses Geist Sans (sans-serif), NOT Fraunces. Confirmed in design
 *   source: fontFamily "'Geist', system-ui, sans-serif". Fraunces is reserved
 *   for heroTitle/headliner type on detail screens.
 * - 3px left edge bar encodes state:
 *     ticketed → accent (gold)
 *     watching → kindColor
 *     past/wishlist → rule (subtle)
 * - compact mode: no surface bg, no card padding, just row + bottom border rule
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { hapticImpactMedium, hapticSelection } from '@/lib/haptics';
import { useFeedback } from '@/lib/feedback';
import { KindBadge } from './KindBadge';
import { StateChip } from './StateChip';
import { RemoteImage } from './design-system/RemoteImage';
import { TicketmasterMark } from './BrandIcons';
import type { Kind, ShowState } from '@/lib/theme';

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
  year: string; // e.g. '2025'
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
   * Optional auth headers for `avatarUrl`. Required when the URL points
   * at a session-gated proxy like `/api/show-cover/<id>` — the Bearer
   * token rides along so expo-image can load it. Direct CDN URLs (TM /
   * Spotify) leave this unset.
   */
  avatarHeaders?: Record<string, string>;
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
  /**
   * Optional testID applied to the row's root Pressable. The Shows tab
   * passes `show-card-row-${index}` so Maestro flows can tap into the
   * first row (`show-card-row-0`); leave unset elsewhere.
   */
  testID?: string;
}

export function ShowCard({
  show,
  onPress,
  onLongPress,
  compact = false,
  testID,
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
      testID={testID}
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

      {/* Date block — 44pt min width. Compact drops the day-of-week and
          year lines (year already shows in the timeline section header)
          and shrinks the day number so the row collapses height-wise. */}
      <View style={styles.dateBlock}>
        <Text style={[styles.dateMonth, { color: colors.muted }]}>{show.month}</Text>
        <Text style={[compact ? styles.dateDayCompact : styles.dateDay, { color: colors.ink }]}>
          {show.day}
        </Text>
        {!compact && (
          <Text style={[styles.dateDow, { color: colors.faint }]}>{show.dow}</Text>
        )}
        {!compact && show.year ? (
          <Text style={[styles.dateYear, { color: colors.faint }]}>{show.year}</Text>
        ) : null}
      </View>

      {/* Optional headliner avatar — opt-in via `show.avatarUrl`. When the
          URL is missing the kind-coloured monogram fallback still renders,
          which is the point: every row gets a face. Hidden in compact mode:
          it's the tallest element in the row and the densest layout trades
          the decorative face for shorter rows + more headliner width. */}
      {!compact && show.avatarUrl !== undefined ? (
        <RemoteImage
          uri={show.avatarUrl}
          headers={show.avatarHeaders}
          name={show.headliner}
          kind={show.kind}
          size="thumb"
          style={styles.avatar}
        />
      ) : null}

      {/* Content column. Comfortable stacks three lines (badges → headliner
          → venue); compact collapses to two: a kind badge inline with the
          headliner, then venue. The StateChip is dropped in compact because
          the coloured left edge bar already encodes the show state. */}
      <View style={[styles.content, compact && styles.contentCompact]}>
        {compact ? (
          <View style={styles.compactHeadlineRow}>
            <KindBadge kind={show.kind} size="sm" />
            <Text
              style={[styles.headlinerCompact, { color: colors.ink }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {show.headliner}
            </Text>
          </View>
        ) : (
          <>
            {/* Badges row */}
            <View style={styles.badgeRow}>
              <KindBadge kind={show.kind} size="sm" />
              {show.state !== 'past' && <StateChip state={show.state} />}
            </View>

            {/* Headliner — Geist Sans (sans), NOT Fraunces */}
            <Text
              style={[styles.headliner, { color: colors.ink }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {show.headliner}
            </Text>
          </>
        )}

        {/* Venue · city */}
        <Text
          style={[compact ? styles.venueCompact : styles.venue, { color: colors.muted }]}
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
          <TicketmasterMark size={16} />
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
    borderRadius: RADII.lg,
    paddingVertical: 14,
    paddingRight: 12,
  },
  compact: {
    paddingVertical: 7,
    paddingRight: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.85,
  },
  stateBar: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: RADII.pill,
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
    fontFamily: 'Geist Sans 500',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 11 * 0.05,
  },
  dateDay: {
    fontFamily: 'Geist Sans 700',
    fontSize: 22,
    lineHeight: 26,
  },
  dateDayCompact: {
    fontFamily: 'Geist Sans 700',
    fontSize: 17,
    lineHeight: 19,
  },
  dateDow: {
    fontFamily: 'Geist Sans 400',
    fontSize: 10,
    textTransform: 'uppercase',
  },
  dateYear: {
    fontFamily: 'Geist Sans 400',
    fontSize: 9,
    letterSpacing: 0.3,
    marginTop: 1,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  contentCompact: {
    gap: 1,
    justifyContent: 'center',
  },
  compactHeadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'nowrap',
  },
  headliner: {
    fontFamily: 'Geist Sans 700', // sans-serif per design source — NOT Fraunces
    fontSize: 16,
    lineHeight: 21,
  },
  headlinerCompact: {
    fontFamily: 'Geist Sans 700',
    fontSize: 15,
    lineHeight: 19,
    flex: 1,
    minWidth: 0,
  },
  venue: {
    fontFamily: 'Geist Sans 400',
    fontSize: 13,
    lineHeight: 18,
  },
  venueCompact: {
    fontFamily: 'Geist Sans 400',
    fontSize: 12,
    lineHeight: 15,
  },
  chevronContainer: {
    justifyContent: 'center',
    paddingLeft: 8,
  },
  ticketAction: {
    alignSelf: 'center',
    width: 30,
    height: 30,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});
