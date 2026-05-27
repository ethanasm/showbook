/**
 * KindChip — small pill with a kind-coloured dot and uppercase label.
 * Mirrors the web `.kind-chip` rule: 6px dot in the kind hue, mono caps
 * label, hairline border in the rule color, pill radius.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, type Kind } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

interface KindChipProps {
  kind: Kind;
  label: string;
}

export function KindChip({ kind, label }: KindChipProps): React.JSX.Element {
  const { tokens } = useTheme();
  const dotColor = tokens.kindColor(kind);
  return (
    <View
      style={[
        styles.container,
        { borderColor: tokens.colors.rule, backgroundColor: 'transparent' },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[styles.label, { color: tokens.colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: RADII.pill,
  },
  label: {
    fontFamily: 'Geist Mono 600',
    fontSize: 10.5,
    letterSpacing: 1.26,
    textTransform: 'uppercase',
  },
});
