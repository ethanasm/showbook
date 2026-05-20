/**
 * HomeHeader — top-of-Home brand block.
 *
 * Renders the gold-ticket `BrandMark` next to the `showbook` wordmark
 * and a small stat strip ("3 on deck · 18 shows this year"). Replaces
 * the old generic "Good morning, Ethan / Home" header — the brand is
 * the anchor on the most-visited screen instead of a salutation that
 * was repeated identically on every cold start.
 *
 * `formatStatStrip` stays exported (and pure) for unit testing.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';
import { BrandMark } from './BrandMark';

export interface HomeHeaderProps {
  /** Count of "on deck" shows — anything ticketed or watching with a future date. */
  upcomingCount: number;
  /** Count of past shows whose date falls in the current calendar year. */
  thisYearCount: number;
  rightAction?: React.ReactNode;
}

export function formatStatStrip(upcomingCount: number, thisYearCount: number): string {
  const parts: string[] = [];
  if (upcomingCount > 0) {
    parts.push(`${upcomingCount} on deck`);
  }
  if (thisYearCount > 0) {
    parts.push(
      `${thisYearCount} show${thisYearCount === 1 ? '' : 's'} this year`,
    );
  }
  return parts.join('  ·  ');
}

export function HomeHeader({
  upcomingCount,
  thisYearCount,
  rightAction,
}: HomeHeaderProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const stat = formatStatStrip(upcomingCount, thisYearCount);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.row}>
        <View style={styles.brandGroup}>
          <BrandMark size={32} />
          <Text style={[styles.wordmark, { color: colors.ink }]} numberOfLines={1}>
            showbook
          </Text>
        </View>
        {rightAction ? <View>{rightAction}</View> : null}
      </View>
      {stat ? (
        <Text style={[styles.stat, { color: colors.muted }]} numberOfLines={1}>
          {stat}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  wordmark: {
    fontFamily: 'Geist Sans',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 26,
  },
  stat: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.4,
    marginTop: 10,
  },
});
