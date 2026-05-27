/**
 * PulseDot — small accent dot that breathes on a 1.6s cycle. Mirrors the
 * web `.pulse-dot` rule (6px circle, scale 0.85↔1.10, opacity 0.4↔1.0).
 * Driven by Reanimated; respects reduced motion.
 */

import React, { useEffect } from 'react';
import { StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';

interface PulseDotProps {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export function PulseDot({ size = 6, color, style }: PulseDotProps): React.JSX.Element {
  const { tokens } = useTheme();
  const dotColor = color ?? tokens.colors.accent;
  const reduced = useReducedMotion();

  // Shared values for the two animated attributes.
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      progress.value = 0.5; // settle at the "midpoint" so the dot is visible
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [progress, reduced]);

  const animatedStyle = useAnimatedStyle(() => {
    const t = progress.value;
    // scale 0.85 → 1.10
    const scale = 0.85 + t * 0.25;
    // opacity 0.4 → 1.0
    const opacity = 0.4 + t * 0.6;
    return { transform: [{ scale }], opacity };
  });

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: dotColor,
          shadowColor: dotColor,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    // Soft glow under the dot — matches `box-shadow: 0 0 12px var(--accent)`
    // on web. iOS reads shadow*, Android needs elevation; tiny elevation
    // adds a faint outer halo which is the same vibe.
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 6,
    shadowOpacity: 0.8,
    elevation: 2,
  },
});
