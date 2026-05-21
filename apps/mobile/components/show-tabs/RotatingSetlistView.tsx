/**
 * RotatingSetlistView (mobile) — Phase 10 port of the web rotating-
 * style subtree. Mirrors `apps/web/components/show-tabs/
 * RotatingSetlistView.tsx`: confidence banner + multi-night context
 * + gap chart + bustout candidates + position pools.
 *
 * The hype-playlist card is hidden for rotating per SI-05 — enforced
 * by the parent SetlistTab via `shouldRenderHypePlaylistCard`.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../lib/theme';
import { ConfidenceBanner } from './ConfidenceBanner';
import { SectionFrame } from './SectionFrame';

// Mirror of `RotatingPrediction` from @showbook/api — we keep the
// minimal shape inline to avoid pulling in the server bundle.
export interface RotatingPredictionLike {
  style: 'rotating';
  confidence: number;
  sampleSize: number;
  tourName: string | null;
  copy: string;
  multiNightContext: {
    runIndex: number;
    venue: string;
    songsAlreadyPlayed: string[];
  } | null;
  due: {
    title: string;
    currentGap: number;
    meanGap: number;
    overdueScore: number;
  }[];
  hot: { title: string; evidence: string }[];
  bustoutCandidates: {
    title: string;
    overdueScore: number;
    totalPlays: number;
  }[];
  positions: {
    role: string;
    poolEntropy: number;
    candidates: {
      title: string;
      slotShare: number;
      playedThisRun: boolean;
      dueDoubleFlag: boolean;
    }[];
  }[];
}

const ROLE_LABELS: Record<string, string> = {
  opener: 'OPENER',
  closer: 'CLOSER',
  encore_open: 'ENCORE OPEN',
  encore_close: 'ENCORE CLOSE',
};

interface RotatingSetlistViewProps {
  prediction: RotatingPredictionLike;
}

export function RotatingSetlistView({
  prediction,
}: RotatingSetlistViewProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View testID="rotating-setlist-view">
      <ConfidenceBanner
        confidence={prediction.confidence}
        sampleSize={prediction.sampleSize}
        tourName={prediction.tourName}
        archetype="ROTATING"
        subCopy={prediction.copy}
      />
      {prediction.multiNightContext ? (
        <View
          testID="multi-night-context-banner"
          style={[
            styles.multiNight,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.rule,
            },
          ]}
        >
          <Text style={[styles.multiNightTitle, { color: colors.ink }]}>
            Night {prediction.multiNightContext.runIndex} at{' '}
            {prediction.multiNightContext.venue}
          </Text>
          <Text style={[styles.multiNightSub, { color: colors.muted }]}>
            {prediction.multiNightContext.songsAlreadyPlayed.length} songs
            already played this run — excluded from tonight&rsquo;s picks.
          </Text>
        </View>
      ) : null}
      {prediction.due.length > 0 ? (
        <SectionFrame title="Due" count={prediction.due.length}>
          <View testID="rotating-due-list">
            {prediction.due.map((song, idx) => (
              <GapChartRow key={`due-${idx}-${song.title}`} song={song} />
            ))}
          </View>
        </SectionFrame>
      ) : null}
      {prediction.hot.length > 0 ? (
        <SectionFrame title="Hot" count={prediction.hot.length}>
          <View testID="rotating-hot-list">
            {prediction.hot.map((s, idx) => (
              <HotRow
                key={`hot-${idx}-${s.title}`}
                title={s.title}
                evidence={s.evidence}
              />
            ))}
          </View>
        </SectionFrame>
      ) : null}
      {prediction.bustoutCandidates.length > 0 ? (
        <SectionFrame
          title="Bustout candidates"
          count={prediction.bustoutCandidates.length}
        >
          <View testID="rotating-bustout-list">
            {prediction.bustoutCandidates.map((song, idx) => (
              <BustoutRow key={`bustout-${idx}-${song.title}`} song={song} />
            ))}
          </View>
        </SectionFrame>
      ) : null}
      {prediction.positions.length > 0 ? (
        <SectionFrame title="Position pools">
          <View testID="rotating-position-pools">
            {prediction.positions.map((pool) => (
              <PositionPoolCard key={pool.role} pool={pool} />
            ))}
          </View>
        </SectionFrame>
      ) : null}
    </View>
  );
}

function GapChartRow({
  song,
}: {
  song: RotatingPredictionLike['due'][number];
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const pct = Math.min(100, Math.round((song.overdueScore / 4) * 100));
  return (
    <View
      testID="gap-chart-row"
      style={[styles.gapRow, { borderBottomColor: colors.rule }]}
    >
      <Text style={[styles.gapTitle, { color: colors.ink }]}>{song.title}</Text>
      <View style={styles.gapMeter}>
        <View style={[styles.gapTrack, { backgroundColor: colors.rule }]}>
          <View
            style={{
              backgroundColor: colors.accent,
              height: 6,
              width: `${pct}%`,
            }}
          />
        </View>
      </View>
      <Text style={[styles.gapEvidence, { color: colors.muted }]}>
        {song.currentGap}-show gap · avg {song.meanGap.toFixed(0)}
      </Text>
    </View>
  );
}

function HotRow({
  title,
  evidence,
}: {
  title: string;
  evidence: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      testID="rotating-hot-row"
      style={[styles.hotRow, { borderBottomColor: colors.rule }]}
    >
      <Text style={[styles.hotTitle, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.hotEvidence, { color: colors.muted }]}>
        {evidence}
      </Text>
    </View>
  );
}

function BustoutRow({
  song,
}: {
  song: RotatingPredictionLike['bustoutCandidates'][number];
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      testID="bustout-candidate-row"
      style={[styles.bustoutRow, { borderBottomColor: colors.rule }]}
    >
      <Text style={styles.bustoutGlyph}>✨</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.bustoutTitle, { color: colors.ink }]}>
          {song.title}
        </Text>
        <Text style={[styles.bustoutSub, { color: colors.muted }]}>
          {song.totalPlays} total plays · long-overdue
        </Text>
      </View>
      <Text style={[styles.bustoutScore, { color: colors.accent }]}>
        ×{song.overdueScore.toFixed(1)}
      </Text>
    </View>
  );
}

function PositionPoolCard({
  pool,
}: {
  pool: RotatingPredictionLike['positions'][number];
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      testID="position-pool-card"
      style={[styles.poolCard, { borderBottomColor: colors.rule }]}
    >
      <View style={styles.poolHeader}>
        <Text style={[styles.poolRole, { color: colors.muted }]}>
          {ROLE_LABELS[pool.role] ?? pool.role.toUpperCase()}
        </Text>
        <Text style={[styles.poolEntropy, { color: colors.muted }]}>
          entropy {pool.poolEntropy.toFixed(2)}
        </Text>
      </View>
      {pool.candidates.length === 0 ? (
        <Text style={[styles.poolEmpty, { color: colors.faint }]}>
          No candidates in corpus yet.
        </Text>
      ) : (
        pool.candidates.map((c) => (
          <View
            key={`${pool.role}-${c.title}`}
            testID="position-pool-candidate"
            style={[
              styles.poolCandidate,
              c.playedThisRun && { opacity: 0.4 },
            ]}
          >
            <Text
              style={[
                styles.poolCandidateTitle,
                {
                  color: colors.ink,
                  textDecorationLine: c.playedThisRun ? 'line-through' : 'none',
                },
              ]}
            >
              {c.title}
            </Text>
            {c.dueDoubleFlag ? (
              <View
                testID="due-double-flag"
                style={[styles.dueBadge, { backgroundColor: colors.accent }]}
              >
                <Text style={[styles.dueBadgeText, { color: colors.accentText }]}>
                  ★ DUE
                </Text>
              </View>
            ) : null}
            <Text style={[styles.poolCandidatePct, { color: colors.muted }]}>
              {Math.round(c.slotShare * 100)}%
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  multiNight: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  multiNightTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
  },
  multiNightSub: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
    lineHeight: 16,
  },
  gapRow: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gapTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
  },
  gapMeter: {
    marginTop: 6,
  },
  gapTrack: {
    height: 6,
    width: '100%',
  },
  gapEvidence: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
    marginTop: 4,
  },
  hotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hotTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    flex: 1,
    minWidth: 0,
  },
  hotEvidence: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
    marginLeft: 12,
  },
  bustoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bustoutGlyph: {
    fontSize: 14,
  },
  bustoutTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
  },
  bustoutSub: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  bustoutScore: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  poolCard: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  poolHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  poolRole: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 1.4,
  },
  poolEntropy: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
  },
  poolEmpty: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
  },
  poolCandidate: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingVertical: 2,
  },
  poolCandidateTitle: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 13,
  },
  poolCandidatePct: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
    width: 40,
    textAlign: 'right',
  },
  dueBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  dueBadgeText: {
    fontFamily: 'Geist Mono',
    fontSize: 9.5,
    letterSpacing: 0.8,
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
