/**
 * Skeleton — pulse-animation loading placeholder.
 *
 * Uses RN's built-in Animated API (not Reanimated) — lightweight, no extra dep.
 * Animation: opacity 0.5 → 0.9 → 0.5 on a 1.5s loop (no horizontal shimmer).
 * Background: tokens.colors.rule — subtle enough for both modes.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, type DimensionValue } from 'react-native';
import { useTheme } from '../lib/theme';

export interface SkeletonProps {
  width: number | string;
  height: number;
  radius?: number;
}

export function Skeleton({ width, height, radius }: SkeletonProps): React.JSX.Element {
  const { tokens } = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;

  const resolvedRadius = radius ?? tokens.radii.md;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.9,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 750,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.base,
        {
          width: width as DimensionValue,
          height,
          borderRadius: resolvedRadius,
          backgroundColor: tokens.colors.rule,
          opacity,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});
