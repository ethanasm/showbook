/**
 * PulseLabel — mono small-caps row with a breathing accent dot in front.
 * Mirrors the web `.pulse-label` rule.
 */

import React from 'react';
import { View, Text, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { useTheme } from '../../lib/theme';
import { PulseDot } from './PulseDot';

interface PulseLabelProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function PulseLabel({ children, style }: PulseLabelProps): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View style={[styles.row, style]}>
      <PulseDot />
      <Text style={[styles.label, { color: tokens.colors.muted }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 1.98,
    textTransform: 'uppercase',
  },
});
