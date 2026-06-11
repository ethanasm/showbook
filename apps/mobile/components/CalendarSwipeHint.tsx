/**
 * CalendarSwipeHint — transient, one-time coach hint shown under the
 * Shows-tab calendar telling the user the grid is swipeable between
 * months / years. The Pan gesture in `CalendarView` is otherwise
 * invisible: there's nothing on screen that says "you can drag this",
 * so first-time users only ever discover the prev/next arrows.
 *
 * Pairs with the one-shot grid "nudge" animation driven from
 * `CalendarView`. Dismissal is owned by the parent (persisted in
 * expo-secure-store under `showbook.hint.calendar-swipe`, matching the
 * TicketStatusHint / GetStartedHub pattern) and fires on the first real
 * swipe or a tap. A short visibility timeout only hides it for the
 * current session — it does *not* burn the one-time flag, so a user who
 * glances away still gets one more chance next time the calendar opens.
 */

import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

const AUTO_HIDE_MS = 6_000;

export function CalendarSwipeHint({
  visible,
  period,
  onDismiss,
}: {
  visible: boolean;
  /** Drives the copy: "Swipe to change months" vs. "…years". */
  period: 'month' | 'year';
  /** Persist the one-time flag (tap-to-dismiss). The parent also calls
   *  this from the gesture handler on the first committed swipe. */
  onDismiss: () => void;
}): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  // Session-only auto-hide so the hint doesn't linger forever on screen,
  // kept separate from the persisted dismissal the parent owns.
  const [autoHidden, setAutoHidden] = React.useState(false);
  const wiggle = useSharedValue(0);

  React.useEffect(() => {
    if (!visible) return;
    setAutoHidden(false);
    // Gentle, looping left↔right telegraph on the chevrons.
    wiggle.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 720, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 720, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    const t = setTimeout(() => setAutoHidden(true), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [visible, wiggle]);

  const leftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -wiggle.value * 3 }],
    opacity: 0.55 + wiggle.value * 0.45,
  }));
  const rightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: wiggle.value * 3 }],
    opacity: 0.55 + wiggle.value * 0.45,
  }));

  if (!visible || autoHidden) return null;

  return (
    <Pressable
      testID="calendar-swipe-hint"
      onPress={onDismiss}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Swipe the calendar left or right to change ${period}s. Tap to dismiss.`}
      style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.6 }]}
    >
      <Animated.View style={leftStyle}>
        <ChevronLeft size={14} color={colors.muted} />
      </Animated.View>
      <Text style={[styles.label, { color: colors.muted, backgroundColor: colors.surfaceRaised }]}>
        Swipe to change {period}s
      </Text>
      <Animated.View style={rightStyle}>
        <ChevronRight size={14} color={colors.muted} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: -4,
  },
  label: {
    fontFamily: 'Geist Sans 500',
    fontSize: 11,
    letterSpacing: 0.3,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    overflow: 'hidden',
  },
});
