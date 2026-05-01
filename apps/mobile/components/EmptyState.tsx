/**
 * EmptyState — centered placeholder for empty list/screen states.
 *
 * The icon slot accepts any React node (typically a lucide icon at size 40).
 * Opacity 0.3 wrapper gives the faded look from the design.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';
import { RADII } from '../lib/theme-utils';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  cta?: { label: string; onPress: () => void };
}

export function EmptyState({ icon, title, subtitle, cta }: EmptyStateProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <View style={styles.container}>
      {icon && <View style={styles.iconWrapper}>{icon}</View>}

      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>

      {subtitle && (
        <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text>
      )}

      {cta && (
        <Pressable
          onPress={cta.onPress}
          style={({ pressed }) => [
            styles.ctaButton,
            { backgroundColor: colors.accent },
            pressed && styles.ctaPressed,
          ]}
        >
          <Text style={[styles.ctaLabel, { color: colors.accentText }]}>{cta.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    gap: 12,
  },
  iconWrapper: {
    opacity: 0.3,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 20,
  },
  ctaButton: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: RADII.pill,
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
  },
});
