/**
 * EncoreDivider (mobile) — caps the encore section of a setlist with
 * a centered ENCORE label flanked by hairline rules. Mirrors the web
 * `EncoreDivider`.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

export interface EncoreDividerProps {
  label?: string;
}

export function EncoreDivider({
  label = 'ENCORE',
}: EncoreDividerProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View testID="encore-divider" style={styles.row}>
      <Text style={[styles.label, { color: colors.accent }]}>— {label}</Text>
      <View style={[styles.rule, { backgroundColor: colors.rule }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  label: {
    fontFamily: 'Geist Mono 600',
    fontSize: 10,
    letterSpacing: 1.6,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
});
