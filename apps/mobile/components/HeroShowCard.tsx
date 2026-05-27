/**
 * HeroShowCard — full-bleed featured-show treatment for the Home tab.
 *
 * Renders the next ticketed show (or the now-playing-today show when
 * present) as a 220pt-tall image card instead of a row. The headliner
 * photo (falling back to the venue photo, then to the kind-coloured
 * monogram) bleeds edge-to-edge with a bottom-up dark gradient overlay
 * so the date / headliner / venue stack stays readable on any artwork.
 *
 * Why a sibling component instead of a `variant` prop on ShowCard:
 *   the row uses a fixed left-bar + date-block + chevron layout that
 *   doesn't decompose well into a stacked, image-backed treatment.
 *   Sharing types (`ShowCardShow`) keeps the conversion sites honest.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { hapticImpactMedium } from '@/lib/haptics';
import { KindBadge } from './KindBadge';
import { StateChip } from './StateChip';
import { RemoteImage } from './design-system/RemoteImage';
import { useLiveCountdown } from '@showbook/shared/hooks';
import type { ShowCardShow } from './ShowCard';

export interface HeroShowCardProps {
  show: ShowCardShow;
  /** Optional artwork URL (headliner image first, venue photo as fallback). */
  imageUrl?: string | null;
  /**
   * Optional HTTP headers attached to the image fetch. Needed when the
   * URL points at our session-gated `/api/venue-photo/<id>` proxy so the
   * Bearer JWT can travel with the request — see `lib/images.ts`.
   */
  imageHeaders?: Record<string, string>;
  /** Show date as YYYY-MM-DD, used for the live countdown chip. */
  dateYmd: string | null;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function HeroShowCard({
  show,
  imageUrl,
  imageHeaders,
  dateYmd,
  onPress,
  onLongPress,
  style,
}: HeroShowCardProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const countdown = useLiveCountdown(dateYmd, { fallback: '' });

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
        { backgroundColor: colors.surface },
        pressed && styles.pressed,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${show.headliner} at ${show.venue}`}
    >
      <RemoteImage
        uri={imageUrl ?? null}
        headers={imageHeaders}
        name={show.headliner}
        kind={show.kind}
        size="custom"
        width={undefined}
        height={undefined}
        style={StyleSheet.absoluteFillObject}
        accessibilityLabel={`${show.headliner} photo`}
      />

      {/* Bottom-up gradient — keeps the text stack legible on any artwork.
          The top stop is fully transparent so the badges at the top read
          against the photo itself (most artist photos have the head in
          the upper third — see RemoteImage hero crop). */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.78)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {/* Top row: badges left, countdown right */}
      <View style={styles.topRow} pointerEvents="none">
        <View style={styles.badgeRow}>
          <KindBadge kind={show.kind} size="sm" tone="onPhoto" />
          {show.state !== 'past' && <StateChip state={show.state} tone="onPhoto" />}
        </View>
        {countdown ? (
          <View style={styles.countdownChip}>
            <View style={[styles.countdownDot, { backgroundColor: colors.accent }]} />
            <Text style={styles.countdownText}>{countdown.toUpperCase()}</Text>
          </View>
        ) : null}
      </View>

      {/* Bottom stack: date row, headliner, venue */}
      <View style={styles.bottomStack} pointerEvents="none">
        <Text style={styles.dateLine} numberOfLines={1}>
          {show.dow !== '—' ? `${show.dow} · ` : ''}
          {show.month} {show.day}
        </Text>
        <Text style={styles.headliner} numberOfLines={2} ellipsizeMode="tail">
          {show.headliner}
        </Text>
        <Text style={styles.venue} numberOfLines={1} ellipsizeMode="tail">
          {show.venue}
          {show.city ? ` · ${show.city}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 220,
    borderRadius: RADII.xl,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  pressed: {
    opacity: 0.92,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 14,
    gap: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  countdownChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  countdownDot: {
    width: 6,
    height: 6,
    borderRadius: RADII.pill,
  },
  countdownText: {
    fontFamily: 'Geist Mono 600',
    fontSize: 10.5,
    color: '#fff',
    letterSpacing: 0.6,
  },
  bottomStack: {
    padding: 16,
    gap: 4,
  },
  dateLine: {
    fontFamily: 'Geist Sans 600',
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 11 * 0.08,
  },
  headliner: {
    fontFamily: 'Fraunces',
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 30,
  },
  venue: {
    fontFamily: 'Geist Sans 500',
    fontSize: 13,
    color: 'rgba(255,255,255,0.88)',
  },
});
