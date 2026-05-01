/**
 * TopBar — screen header chrome (mirrors AppHeader in design handoff).
 *
 * Safe area: TopBar renders its own layout but does NOT include SafeAreaView.
 * The parent Stack layout (added in Task 6 root layout) handles the top inset
 * via react-native-safe-area-context. If used outside a Stack, wrap the parent
 * in <SafeAreaView edges={['top']}.
 *
 * Large variant: 28/700 Georgia title, no bottom border, bottom padding 16.
 * Regular variant: 17/600 Geist title, 1px rule bottom border, bottom padding 12.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';

export interface TopBarProps {
  title: string;
  eyebrow?: string;
  rightAction?: React.ReactNode;
  leading?: React.ReactNode;
  large?: boolean;
}

export function TopBar({
  title,
  eyebrow,
  rightAction,
  leading,
  large = false,
}: TopBarProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <View
      style={[
        styles.container,
        large ? styles.containerLarge : styles.containerRegular,
        !large && { borderBottomColor: colors.rule, borderBottomWidth: 1 },
        { backgroundColor: colors.bg },
      ]}
    >
      <View style={styles.inner}>
        {/* Leading + title group */}
        <View style={styles.titleGroup}>
          {leading && <View style={styles.leading}>{leading}</View>}
          <View style={styles.titleContent}>
            {eyebrow && (
              <Text style={[styles.eyebrow, { color: colors.muted }]}>{eyebrow}</Text>
            )}
            <Text
              style={[
                large ? styles.titleLarge : styles.titleRegular,
                { color: colors.ink },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {title}
            </Text>
          </View>
        </View>

        {/* Right action slot */}
        {rightAction && <View>{rightAction}</View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  containerRegular: {
    paddingBottom: 12,
  },
  containerLarge: {
    paddingBottom: 16,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  leading: {
    flexShrink: 0,
  },
  titleContent: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 10.5 * 0.1, // 0.1em per design
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  titleRegular: {
    fontFamily: 'Geist Sans',
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 21,
  },
  titleLarge: {
    // Large variant uses Georgia (per design: large ? 'Georgia' : 'Geist Sans')
    // Note: design AppHeader source shows fontFamily: "'Geist', system-ui, sans-serif"
    // for large, but the spec says 28/700 Georgia — spec takes precedence.
    fontFamily: 'Georgia',
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 31, // 28 × 1.1
    letterSpacing: -0.28, // -0.01em
  },
});
