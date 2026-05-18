/**
 * PredictedSetlistRow (mobile) — single row in the Setlist tab's
 * predicted-or-actual list. Mirrors the web `PredictedSetlistRow`:
 * position number · TrackPreview button · title · optional evidence
 * line · inline song badges (🆕 / 🎯). Past-show "actual · setlist.fm"
 * boilerplate is omitted upstream so rows for played songs look clean.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../lib/theme';
import { TrackPreviewButton } from './TrackPreviewButton';
import type { SongBadge } from '../../lib/setlist-intel';

export type RowRole = 'opener' | 'closer' | 'encore_open' | 'encore_close' | 'core';

export interface PredictedSetlistRowProps {
  position: number;
  title: string;
  evidence: string;
  role: RowRole;
  showId: string;
  previewUrl: string | null;
  spotifyTrackId: string | null;
  badge?: SongBadge;
}

export function PredictedSetlistRow({
  position,
  title,
  evidence,
  showId,
  previewUrl,
  spotifyTrackId,
  badge,
}: PredictedSetlistRowProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const showEvidence = evidence.length > 0;
  return (
    <View
      testID="predicted-setlist-row"
      style={[styles.row, { borderBottomColor: colors.rule }]}
    >
      <Text style={[styles.position, { color: colors.faint }]}>
        {String(position).padStart(2, '0')}
      </Text>
      <TrackPreviewButton
        showId={showId}
        title={title}
        previewUrl={previewUrl}
        spotifyTrackId={spotifyTrackId}
      />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, { color: colors.ink }]}
            numberOfLines={2}
          >
            {title}
          </Text>
          {badge?.firstTime ? (
            <Text
              style={[styles.badgeText, { color: colors.accent }]}
              testID="predicted-row-badge-first-time"
            >
              NEW
            </Text>
          ) : null}
          {badge?.rareCatch ? (
            <Text
              style={[styles.badgeText, { color: colors.muted }]}
              testID="predicted-row-badge-rare"
            >
              RARE · {badge.rareCatch.fractionPct}%
            </Text>
          ) : null}
        </View>
        {showEvidence ? (
          <Text
            style={[styles.evidence, { color: colors.muted }]}
            numberOfLines={2}
          >
            {evidence}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  position: {
    width: 22,
    textAlign: 'right',
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  evidence: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.3,
    marginTop: 2,
  },
  badgeText: {
    fontFamily: 'Geist Mono',
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
});
