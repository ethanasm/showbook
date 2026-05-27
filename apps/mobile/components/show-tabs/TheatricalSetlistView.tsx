/**
 * TheatricalSetlistView (mobile) — Phase 10 port of the web theatrical
 * subtree. ActDividers walk the deterministic program rows + rotating
 * slot cards (1-3 song slots that vary night-to-night) in show order.
 *
 * Theatrical KEEPS the hype playlist card per Phase 6 §1 — the parent
 * SetlistTab decides whether to mount it.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { ConfidenceBanner } from './ConfidenceBanner';

export interface TheatricalPredictionLike {
  style: 'theatrical';
  confidence: number;
  sampleSize: number;
  tourName: string | null;
  copy: string;
  deterministicSetlist: {
    title: string;
    act: string;
    slotShare: number;
  }[];
  rotatingSlots: {
    act: string;
    slotName: string;
    candidates: { title: string; probability: number }[];
  }[];
}

interface GroupedAct {
  actLabel: string;
  entries: (| {
        kind: 'fixed';
        row: TheatricalPredictionLike['deterministicSetlist'][number];
        position: number;
      }
    | { kind: 'rotating'; slot: TheatricalPredictionLike['rotatingSlots'][number] })[];
}

function groupByAct(prediction: TheatricalPredictionLike): GroupedAct[] {
  const acts = new Map<string, GroupedAct>();
  const order: string[] = [];
  const counter = new Map<string, number>();
  for (const row of prediction.deterministicSetlist) {
    let group = acts.get(row.act);
    if (!group) {
      group = { actLabel: row.act, entries: [] };
      acts.set(row.act, group);
      order.push(row.act);
    }
    const pos = (counter.get(row.act) ?? 0) + 1;
    counter.set(row.act, pos);
    group.entries.push({ kind: 'fixed', row, position: pos });
  }
  for (const slot of prediction.rotatingSlots) {
    let group = acts.get(slot.act);
    if (!group) {
      group = { actLabel: slot.act, entries: [] };
      acts.set(slot.act, group);
      order.push(slot.act);
    }
    group.entries.push({ kind: 'rotating', slot });
  }
  return order.map((label) => acts.get(label) as GroupedAct);
}

interface TheatricalSetlistViewProps {
  prediction: TheatricalPredictionLike;
}

export function TheatricalSetlistView({
  prediction,
}: TheatricalSetlistViewProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const grouped = groupByAct(prediction);
  return (
    <View testID="theatrical-setlist-view">
      <ConfidenceBanner
        confidence={prediction.confidence}
        sampleSize={prediction.sampleSize}
        tourName={prediction.tourName}
        archetype="THEATRICAL"
        subCopy={
          prediction.rotatingSlots.length === 0
            ? 'Every position is locked night-to-night.'
            : `${prediction.rotatingSlots.length} rotating slot${prediction.rotatingSlots.length === 1 ? '' : 's'} vary nightly — surfaced below.`
        }
      />
      <Text style={[styles.copy, { color: colors.muted }]} testID="theatrical-copy">
        {prediction.copy}
      </Text>
      <View testID="theatrical-program">
        {grouped.map((group) => (
          <View key={group.actLabel}>
            <ActDivider label={group.actLabel} />
            {group.entries.map((entry, idx) =>
              entry.kind === 'fixed' ? (
                <TheatricalRow
                  key={`fixed-${group.actLabel}-${idx}-${entry.row.title}`}
                  position={entry.position}
                  title={entry.row.title}
                  slotShare={entry.row.slotShare}
                />
              ) : (
                <RotatingSlotCard
                  key={`rotating-${group.actLabel}-${idx}`}
                  slot={entry.slot}
                />
              ),
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

function ActDivider({ label }: { label: string }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View testID="act-divider" style={styles.actDivider}>
      <Text style={[styles.actLabel, { color: colors.accent }]}>— {label}</Text>
      <View style={[styles.actRule, { backgroundColor: colors.rule }]} />
    </View>
  );
}

function TheatricalRow({
  position,
  title,
  slotShare,
}: {
  position: number;
  title: string;
  slotShare: number;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const pct = Math.round(slotShare * 100);
  return (
    <View
      testID="theatrical-row"
      style={[styles.row, { borderBottomColor: colors.rule }]}
    >
      <Text style={[styles.position, { color: colors.faint }]}>
        {String(position).padStart(2, '0')}
      </Text>
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.share, { color: colors.muted }]}>
        {pct === 100 ? 'every night' : `${pct}% of shows`}
      </Text>
    </View>
  );
}

function RotatingSlotCard({
  slot,
}: {
  slot: TheatricalPredictionLike['rotatingSlots'][number];
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      testID="rotating-slot-card"
      style={[
        styles.slotCard,
        { backgroundColor: colors.surface, borderBottomColor: colors.rule },
      ]}
    >
      <View style={styles.slotHeader}>
        <Text style={styles.slotStar}>⭐</Text>
        <Text style={[styles.slotName, { color: colors.accent }]}>
          {slot.slotName}
        </Text>
        <Text style={[styles.slotKicker, { color: colors.muted }]}>
          tonight one of:
        </Text>
      </View>
      {slot.candidates.map((c) => {
        const pct = Math.round(c.probability * 100);
        return (
          <View
            key={c.title}
            testID="rotating-slot-candidate"
            style={styles.candidate}
          >
            <Text style={[styles.candidateTitle, { color: colors.ink }]}>
              {c.title}
            </Text>
            <View style={styles.candidateBarTrack}>
              <View
                style={[
                  styles.candidateBarFill,
                  { width: `${pct}%`, backgroundColor: colors.accent },
                ]}
              />
            </View>
            <Text style={[styles.candidatePct, { color: colors.muted }]}>
              {pct}%
            </Text>
          </View>
        );
      })}
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
  actDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 16,
    paddingBottom: 6,
    paddingHorizontal: 20,
  },
  actLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.8,
  },
  actRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  position: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    width: 24,
  },
  title: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 14,
  },
  share: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  slotCard: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  slotHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  slotStar: {
    fontSize: 12,
  },
  slotName: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 1.4,
  },
  slotKicker: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
  },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  candidateTitle: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 13,
  },
  candidateBarTrack: {
    width: 60,
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  candidateBarFill: {
    height: 4,
  },
  candidatePct: {
    width: 36,
    textAlign: 'right',
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
