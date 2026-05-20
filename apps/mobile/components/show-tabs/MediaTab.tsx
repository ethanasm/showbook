/**
 * MediaTab (mobile) — photo grid + "what we'll add automatically" stub
 * cards. The photo grid is the existing MediaGrid composed by the
 * caller (mirrors how the web tab takes a `mediaSection` slot).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../lib/theme';
import { SectionFrame } from './SectionFrame';

const PRE_STUBS = [
  { emoji: '🎫', title: 'Ticket stub', sub: 'from Apple Wallet' },
  { emoji: '🎵', title: 'Live playlist', sub: 'after setlist syncs' },
  { emoji: '📍', title: 'Map of venue', sub: 'Google Places' },
];

const PAST_STUBS = [
  { emoji: '🎫', title: 'Ticket stub', sub: 'Apple Wallet' },
  { emoji: '🎵', title: 'I-heard playlist', sub: 'after setlist syncs' },
  { emoji: '📍', title: 'Venue map', sub: 'tap for walk-out gif' },
];

export interface MediaTabProps {
  isPast: boolean;
  mediaCount: number;
  photoGrid: React.ReactNode;
}

export function MediaTab({
  isPast,
  mediaCount,
  photoGrid,
}: MediaTabProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const stubs = isPast ? PAST_STUBS : PRE_STUBS;
  const title = isPast ? 'From the night' : "What we'll add automatically";
  return (
    <View testID="show-tab-media">
      <SectionFrame title="Photos" count={mediaCount}>
        {photoGrid}
      </SectionFrame>
      <SectionFrame title={title}>
        <View style={styles.grid}>
          {stubs.map((stub) => (
            <View
              key={stub.title}
              style={[
                styles.cell,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.rule,
                },
              ]}
            >
              <Text style={styles.emoji}>{stub.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cellTitle, { color: colors.ink }]}>
                  {stub.title}
                </Text>
                <Text style={[styles.cellSub, { color: colors.muted }]}>
                  {stub.sub}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </SectionFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: 8,
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emoji: {
    fontSize: 16,
  },
  cellTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 13.5,
    fontWeight: '500',
  },
  cellSub: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    letterSpacing: 0.3,
    marginTop: 2,
  },
});
