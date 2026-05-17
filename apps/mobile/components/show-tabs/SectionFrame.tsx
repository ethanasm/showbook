/**
 * SectionFrame (mobile) — mirror of the web `SectionFrame`. Renders the
 * tracked-uppercase title + optional `· N` count, then the children.
 * Used inside every show-detail tab body so headings carry a consistent
 * rhythm across the 4-tab layout.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../lib/theme';

export interface SectionFrameProps {
  title: string;
  count?: number;
  children: React.ReactNode;
  testID?: string;
}

export function SectionFrame({
  title,
  count,
  children,
  testID,
}: SectionFrameProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      style={styles.section}
      testID={testID ?? `show-section-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.ink }]}>
          {title.toUpperCase()}
        </Text>
        {count !== undefined ? (
          <Text style={[styles.count, { color: colors.muted }]}> · {count}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 11 * 0.08,
  },
  count: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.4,
  },
});
