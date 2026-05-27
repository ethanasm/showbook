/**
 * ConfidenceBanner (mobile) — pre-show banner shown at the top of the
 * Setlist tab. Mirrors the `.setlist-banner` block on web: big confidence
 * number, archetype label, and a source line tied to the prediction's
 * tour name + sample size.
 *
 * The post-show variant (`PlayedCountBanner`) uses the same chrome but
 * renders the actual song count.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../lib/theme';

export type Archetype = 'STABLE' | 'ROTATING' | 'THEATRICAL' | 'IMPROVISED';

export interface ConfidenceBannerProps {
  confidence: number;
  sampleSize: number;
  tourName: string | null;
  archetype: Archetype;
  subCopy?: string;
}

export function ConfidenceBanner({
  confidence,
  sampleSize,
  tourName,
  archetype,
  subCopy,
}: ConfidenceBannerProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const pct = Math.round(confidence * 100);
  return (
    <View
      testID={`setlist-confidence-banner-${archetype.toLowerCase()}`}
      style={[
        styles.banner,
        { backgroundColor: colors.surface, borderBottomColor: colors.rule },
      ]}
    >
      <View style={styles.lead}>
        <Text style={[styles.number, { color: colors.accent }]}>
          {pct}
          <Text style={[styles.pct, { color: colors.accent }]}>%</Text>
        </Text>
        <View>
          <Text style={[styles.smallLabel, { color: colors.faint }]}>
            CONFIDENCE
          </Text>
          <Text style={[styles.smallValue, { color: colors.muted }]}>
            {archetype} archetype
          </Text>
        </View>
      </View>
      <View style={styles.source}>
        <Text style={[styles.sourceLabel, { color: colors.faint }]}>
          PREDICTED FROM
        </Text>
        <Text style={[styles.sourceLine, { color: colors.ink }]}>
          {tourName ? `${tourName} · ` : ''}
          {sampleSize} setlist{sampleSize === 1 ? '' : 's'} in our corpus
        </Text>
        {subCopy ? (
          <Text style={[styles.sourceSub, { color: colors.muted }]}>
            {subCopy}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export interface PlayedCountBannerProps {
  total: number;
}

export function PlayedCountBanner({ total }: PlayedCountBannerProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      testID="setlist-actual-banner"
      style={[
        styles.banner,
        { backgroundColor: colors.surface, borderBottomColor: colors.rule },
      ]}
    >
      <View style={styles.lead}>
        <Text style={[styles.number, { color: colors.ink }]}>{total}</Text>
        <View>
          <Text style={[styles.smallLabel, { color: colors.faint }]}>
            SONGS PLAYED
          </Text>
          <Text style={[styles.smallValue, { color: colors.accent }]}>
            CONFIRMED
          </Text>
        </View>
      </View>
      <View style={styles.source}>
        <Text style={[styles.sourceLabel, { color: colors.faint }]}>
          SOURCE OF TRUTH
        </Text>
        <Text style={[styles.sourceLine, { color: colors.ink }]}>
          setlist.fm + your edits
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  number: {
    fontFamily: 'Geist Sans',
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: -1,
  },
  pct: {
    fontFamily: 'Geist Mono',
    fontSize: 15,
    fontWeight: '500',
  },
  smallLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 9,
    letterSpacing: 0.8,
  },
  smallValue: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.7,
  },
  source: {
    flex: 1,
    minWidth: 0,
  },
  sourceLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 9,
    letterSpacing: 0.8,
  },
  sourceLine: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    marginTop: 2,
  },
  sourceSub: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    letterSpacing: 0.3,
    marginTop: 4,
    lineHeight: 14,
  },
});
