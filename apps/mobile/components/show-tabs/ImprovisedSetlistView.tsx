/**
 * ImprovisedSetlistView (mobile) — Phase 10 port of the web improvised
 * subtree. Renders the vibe-sketch card + show-mode odds card +
 * popular-picks list when a performer is classified as improvised.
 * Per Phase 8 deferral the radar viz is omitted; the headline
 * descriptor + delta chips still surface.
 *
 * Per SI-05 the hype playlist is hidden upstream for improvised.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { ConfidenceBanner } from './ConfidenceBanner';

export interface ImprovisedPredictionLike {
  style: 'improvised';
  confidence: number;
  sampleSize: number;
  tourName: string | null;
  copy: string;
  vibeSketch: {
    headlineDescriptor: string;
    deltas: { axis: string; description: string }[];
    knownTendencies: string[];
    popularPicks: { title: string; playedShare: number }[];
  };
  showModes: {
    label: string;
    probability: number;
    expectedSongCount: number;
  }[];
}

interface ImprovisedSetlistViewProps {
  prediction: ImprovisedPredictionLike;
}

export function ImprovisedSetlistView({
  prediction,
}: ImprovisedSetlistViewProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View testID="improvised-setlist-view">
      <ConfidenceBanner
        confidence={prediction.confidence}
        sampleSize={prediction.sampleSize}
        tourName={prediction.tourName}
        archetype="IMPROVISED"
        subCopy={prediction.vibeSketch.headlineDescriptor}
      />
      <Text style={[styles.copy, { color: colors.muted }]} testID="improvised-copy">
        {prediction.copy}
      </Text>
      <VibeSketchCard sketch={prediction.vibeSketch} />
      <ShowModeOddsCard modes={prediction.showModes} />
      <PopularPicksList picks={prediction.vibeSketch.popularPicks} />
    </View>
  );
}

function VibeSketchCard({
  sketch,
}: {
  sketch: ImprovisedPredictionLike['vibeSketch'];
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      testID="vibe-sketch-card"
      style={[styles.card, { borderBottomColor: colors.rule }]}
    >
      <Text style={[styles.cardKicker, { color: colors.accent }]}>
        VIBE SKETCH
      </Text>
      <Text style={[styles.cardHeadline, { color: colors.ink }]}>
        {sketch.headlineDescriptor}
      </Text>
      {sketch.deltas.length > 0 ? (
        <View
          testID="vibe-sketch-deltas"
          style={styles.chipRow}
        >
          {sketch.deltas.map((d) => (
            <View
              key={d.axis}
              style={[
                styles.chip,
                { borderColor: colors.accent },
              ]}
            >
              <Text style={[styles.chipText, { color: colors.accent }]}>
                {d.description}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {sketch.knownTendencies.length > 0 ? (
        <View testID="vibe-sketch-tendencies" style={styles.list}>
          {sketch.knownTendencies.map((t) => (
            <Text key={t} style={[styles.listItem, { color: colors.muted }]}>
              · {t}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ShowModeOddsCard({
  modes,
}: {
  modes: ImprovisedPredictionLike['showModes'];
}): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  if (modes.length === 0) return null;
  return (
    <View
      testID="show-mode-odds-card"
      style={[styles.card, { borderBottomColor: colors.rule }]}
    >
      <Text style={[styles.cardKicker, { color: colors.accent }]}>
        TONIGHT&rsquo;S SHAPE
      </Text>
      {modes.map((mode) => {
        const pct = Math.round(mode.probability * 100);
        return (
          <View
            key={mode.label}
            testID="show-mode-row"
            style={styles.modeRow}
          >
            <Text style={[styles.modeLabel, { color: colors.ink }]}>
              {mode.label}
            </Text>
            <View style={styles.modeBarTrack}>
              <View
                style={[
                  styles.modeBarFill,
                  { width: `${pct}%`, backgroundColor: colors.accent },
                ]}
              />
            </View>
            <Text style={[styles.modePct, { color: colors.muted }]}>{pct}%</Text>
            <Text style={[styles.modeCount, { color: colors.faint }]}>
              ~{mode.expectedSongCount}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function PopularPicksList({
  picks,
}: {
  picks: ImprovisedPredictionLike['vibeSketch']['popularPicks'];
}): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  if (picks.length === 0) return null;
  return (
    <View
      testID="popular-picks-list"
      style={[styles.card, { borderBottomColor: colors.rule }]}
    >
      <Text style={[styles.cardKicker, { color: colors.accent }]}>
        POPULAR PICKS
      </Text>
      {picks.map((p) => (
        <View
          key={p.title}
          testID="popular-pick-row"
          style={styles.pickRow}
        >
          <Text style={[styles.pickTitle, { color: colors.ink }]}>{p.title}</Text>
          <Text style={[styles.pickSub, { color: colors.muted }]}>
            {Math.round(p.playedShare * 100)}% of recent
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  copy: {
    fontFamily: 'Geist Mono',
    fontSize: 11.5,
    letterSpacing: 0.3,
    lineHeight: 17,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  card: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardKicker: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 1.4,
  },
  cardHeadline: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  chipText: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
  },
  list: {
    gap: 4,
    marginTop: 4,
  },
  listItem: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    lineHeight: 16,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modeLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    width: 110,
  },
  modeBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  modeBarFill: {
    height: 6,
  },
  modePct: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    width: 40,
    textAlign: 'right',
  },
  modeCount: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    width: 36,
    textAlign: 'right',
  },
  pickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  pickTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    flex: 1,
  },
  pickSub: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  gateBlocked: {
    paddingVertical: 32,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gateBlockedTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  gateBlockedBody: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 360,
  },
});
