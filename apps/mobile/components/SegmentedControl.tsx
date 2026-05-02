/**
 * SegmentedControl — three-up (or n-up) toggle pill matching the design's
 * mobile segmented-control pattern (Light / Dark / System on Me; Timeline /
 * Month / Stats on Shows in M2; etc.).
 *
 * Visual: rule-colored track with a `surface`-tinted active pill. Active
 * label uses ink + 600; inactive uses muted + 400.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { RADII } from '../lib/theme-utils';

export interface SegmentedControlOption<V extends string> {
  value: V;
  label: string;
}

export interface SegmentedControlProps<V extends string> {
  options: SegmentedControlOption<V>[];
  value: V;
  onChange: (value: V) => void;
  testID?: string;
}

export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  testID,
}: SegmentedControlProps<V>): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      testID={testID}
      style={[styles.track, { backgroundColor: colors.rule }]}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
            style={[
              styles.segment,
              active && {
                backgroundColor: colors.surface,
              },
            ]}
          >
            <Text
              style={{
                color: active ? colors.ink : colors.muted,
                fontFamily: 'Geist Sans',
                fontSize: 13,
                fontWeight: active ? '600' : '400',
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: RADII.sm + 2, // 6 — slightly inset from the 8 track
    alignItems: 'center',
    justifyContent: 'center',
  },
});
