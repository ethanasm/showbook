/**
 * HomeHeader — top-of-Home greeting block. Replaces the eyebrow + title
 * pair from the generic `TopBar` for the Home tab specifically.
 *
 * Three lines:
 *   - greeting: "Good morning, Ethan"  (time-of-day + first name fallback)
 *   - title:    "Home"                  (kept for orientation)
 *   - stat strip: "{n} on deck · {m} this year"
 *
 * Pure presentational — counts are passed in so the data shape stays
 * with the screen and unit tests can assert the formatter
 * (`greetingFor`, `formatStatStrip`) independently.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme';

export interface HomeHeaderProps {
  /** SessionUser.name; null when the OAuth profile didn't carry a display name. */
  userName: string | null;
  /** Count of "on deck" shows — anything ticketed or watching with a future date. */
  upcomingCount: number;
  /** Count of past shows whose date falls in the current calendar year. */
  thisYearCount: number;
  /** Optional override for the current time, exposed so tests can pin it. */
  now?: Date;
  rightAction?: React.ReactNode;
}

export function greetingFor(now: Date): string {
  const h = now.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function firstNameOf(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  return first ?? null;
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
  userName,
  upcomingCount,
  thisYearCount,
  now,
  rightAction,
}: HomeHeaderProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  const greetingNow = now ?? new Date();
  const first = firstNameOf(userName);
  const greeting = first
    ? `${greetingFor(greetingNow)}, ${first}`
    : greetingFor(greetingNow);
  const stat = formatStatStrip(upcomingCount, thisYearCount);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.row}>
        <View style={styles.titleGroup}>
          <Text style={[styles.greeting, { color: colors.muted }]} numberOfLines={1}>
            {greeting}
          </Text>
          <Text style={[styles.title, { color: colors.ink }]}>Home</Text>
          {stat ? (
            <Text style={[styles.stat, { color: colors.muted }]} numberOfLines={1}>
              {stat}
            </Text>
          ) : null}
        </View>
        {rightAction ? <View>{rightAction}</View> : null}
      </View>
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
  greeting: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 2,
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 31,
    letterSpacing: -0.28,
  },
  stat: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.4,
    marginTop: 6,
  },
});
