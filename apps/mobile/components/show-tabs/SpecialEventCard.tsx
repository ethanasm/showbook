/**
 * Phase 11 §15g — mobile parallel for the special-event empty state.
 * Mirrors `apps/web/components/show-tabs/SpecialEventCard.tsx`.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

interface PastEvent {
  date: string;
  performanceDate: string;
  venueName: string | null;
  songCount: number;
}

export interface SpecialEventCardProps {
  copy: string;
  pastEvents: ReadonlyArray<PastEvent>;
}

export function SpecialEventCard({
  copy,
  pastEvents,
}: SpecialEventCardProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View style={[styles.card, { borderColor: colors.rule, backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.accent }]}>
        TONIGHT IS A SPECIAL ONE
      </Text>
      <Text style={[styles.copy, { color: colors.ink }]}>{copy}</Text>
      {pastEvents.length > 0 ? (
        <>
          <Text style={[styles.pastTitle, { color: colors.muted }]}>
            FROM THE ARCHIVE
          </Text>
          {pastEvents.map((e) => (
            <View
              key={e.performanceDate}
              style={[styles.pastRow, { borderColor: colors.rule }]}
            >
              <Text style={[styles.pastDate, { color: colors.ink }]}>
                {e.date}
              </Text>
              <Text style={[styles.pastMeta, { color: colors.muted }]}>
                {e.venueName ? `${e.venueName} · ` : ''}
                {e.songCount} songs
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 20,
    marginTop: 12,
  },
  title: {
    fontSize: 12,
    letterSpacing: 1.2,
    marginBottom: 10,
    fontWeight: '600',
  },
  copy: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  pastTitle: {
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 6,
  },
  pastRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  pastDate: {
    fontSize: 13,
  },
  pastMeta: {
    fontSize: 12,
  },
});
