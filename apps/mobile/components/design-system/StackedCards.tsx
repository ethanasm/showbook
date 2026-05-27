/**
 * StackedCards — the "crooked rows" decorative element used in the
 * editorial empty state. Four ticket-shaped rows rotated by a couple of
 * degrees each, drifting on offset 12-15s cycles so they "breathe"
 * rather than animate. Mirrors the web `apps/web/components/design-system/
 * StackedCards.tsx` plus the matching keyframes in design-system.css.
 *
 * On reduced-motion we keep the rotation but skip the drift, matching the
 * web @media (prefers-reduced-motion) override.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import { useTheme, type Kind } from '../../lib/theme';
import { RADII } from '../../lib/theme-utils';

export type StackedCardState = 'ticketed' | 'watching' | 'seen';

export interface StackedCardItem {
  kind: Kind;
  day: string;
  month: string;
  title: string;
  venue: string;
  state: StackedCardState;
}

const DEFAULT_ITEMS: StackedCardItem[] = [
  {
    kind: 'concert',
    day: '14',
    month: 'MAY',
    title: 'Phoebe Bridgers',
    venue: 'Forest Hills · Queens',
    state: 'ticketed',
  },
  {
    kind: 'theatre',
    day: '02',
    month: 'JUN',
    title: 'Hamlet',
    venue: 'Royal Shakespeare · Stratford',
    state: 'watching',
  },
  {
    kind: 'comedy',
    day: '21',
    month: 'MAR',
    title: 'John Mulaney',
    venue: 'Beacon Theatre · NYC',
    state: 'seen',
  },
  {
    kind: 'festival',
    day: '11',
    month: 'JUL',
    title: 'Pitchfork Festival',
    venue: 'Union Park · Chicago',
    state: 'watching',
  },
];

const STATE_LABELS: Record<StackedCardState, string> = {
  ticketed: 'Ticketed',
  watching: 'Watching',
  seen: 'Seen',
};

// Per-card transforms match the web `.stacked-card:nth-child(N)` rules.
// Each card has a base translateX + rotation and drifts ±3px on a 12-15s
// cycle that's offset between cards so they never move in lockstep.
const TRANSFORMS = [
  { baseTx: -16, driftTx: 2, baseDeg: -1.5, driftDeg: 0.2, driftTy: -3, duration: 12000 },
  { baseTx: 6, driftTx: 2, baseDeg: 0.5, driftDeg: 0.2, driftTy: 2, duration: 14000 },
  { baseTx: -8, driftTx: -2, baseDeg: -0.8, driftDeg: 0.2, driftTy: -2, duration: 13000 },
  { baseTx: 12, driftTx: -2, baseDeg: 1.2, driftDeg: 0.2, driftTy: 3, duration: 15000 },
] as const;

interface StackedCardsProps {
  items?: StackedCardItem[];
}

export function StackedCards({ items = DEFAULT_ITEMS }: StackedCardsProps): React.JSX.Element {
  const visibleItems = items.slice(0, 4);
  return (
    <View style={styles.stack} pointerEvents="none">
      {visibleItems.map((item, idx) => (
        <DriftingCard
          key={`${item.kind}-${item.title}-${item.day}`}
          item={item}
          index={idx}
        />
      ))}
    </View>
  );
}

function DriftingCard({
  item,
  index,
}: {
  item: StackedCardItem;
  index: number;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const reduced = useReducedMotion();
  const t = TRANSFORMS[index] ?? TRANSFORMS[0];

  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      progress.value = 0;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: t.duration, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [progress, reduced, t.duration]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const tx = t.baseTx + t.driftTx * p;
    const ty = t.driftTy * p;
    const deg = t.baseDeg + t.driftDeg * p;
    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { rotate: `${deg}deg` },
      ],
    };
  });

  const kindColor = tokens.kindColor(item.kind);

  // State chip styling mirrors the web `.stacked-card__chip--*` rules.
  let chipBg: string;
  let chipColor: string;
  let chipBorderColor: string | undefined;
  if (item.state === 'ticketed') {
    chipBg = colors.accent;
    chipColor = colors.accentText;
    chipBorderColor = undefined;
  } else if (item.state === 'watching') {
    chipBg = 'transparent';
    chipColor = colors.ink;
    chipBorderColor = colors.ruleStrong;
  } else {
    chipBg = 'transparent';
    chipColor = colors.muted;
    chipBorderColor = colors.rule;
  }

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.rule,
        },
        animatedStyle,
      ]}
    >
      <View style={[styles.bar, { backgroundColor: kindColor }]} />
      <View style={styles.date}>
        <Text style={[styles.dateDay, { color: colors.ink }]}>{item.day}</Text>
        <Text style={[styles.dateMonth, { color: colors.muted }]}>{item.month}</Text>
      </View>
      <View style={styles.body}>
        <Text
          style={[styles.title, { color: colors.ink }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {item.title}
        </Text>
        <Text
          style={[styles.venue, { color: colors.muted }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {item.venue}
        </Text>
      </View>
      <View
        style={[
          styles.chip,
          {
            backgroundColor: chipBg,
            borderColor: chipBorderColor ?? 'transparent',
            borderWidth: chipBorderColor ? StyleSheet.hairlineWidth : 0,
          },
        ]}
      >
        <Text style={[styles.chipLabel, { color: chipColor }]}>
          {STATE_LABELS[item.state]}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 12,
    width: '100%',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: RADII.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    // Soft drop shadow for the "lifted ticket" feel; matches the web
    // box-shadow: 0 24px 60px -30px rgba(0,0,0,0.6).
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.32,
    shadowRadius: 24,
    elevation: 4,
  },
  bar: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: RADII.pill,
  },
  date: {
    width: 44,
    alignItems: 'center',
  },
  dateDay: {
    fontFamily: 'Geist Sans',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 22,
  },
  dateMonth: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    letterSpacing: 0.6,
    marginTop: 1,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  venue: {
    fontFamily: 'Geist Sans',
    fontSize: 11.5,
    fontWeight: '400',
    lineHeight: 15,
    marginTop: 2,
  },
  chip: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: RADII.pill,
  },
  chipLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.08,
    textTransform: 'uppercase',
  },
});
