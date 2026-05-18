/**
 * PredictedSetlistRow (mobile) — single row in the Setlist tab's
 * predicted-or-actual list. Mirrors the web `PredictedSetlistRow` —
 * position number · TrackPreview button · title + evidence · ★ marker
 * for openers/closers/encore-edges. Inline song badges (🆕 / 🎯) ride
 * along underneath the evidence line.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useTheme } from '../../lib/theme';
import { TrackPreviewButton } from './TrackPreviewButton';
import type { SongBadge } from '../../lib/setlist-intel';

const STAR_ROLES = new Set([
  'opener',
  'closer',
  'encore_open',
  'encore_close',
]);

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
  /** When provided, the title/evidence area becomes tappable and opens
   *  the song-detail screen. Only past shows carry song IDs (from
   *  `shows.songBadges`), so predicted rows leave this undefined. */
  songId?: string | null;
}

export function PredictedSetlistRow({
  position,
  title,
  evidence,
  role,
  showId,
  previewUrl,
  spotifyTrackId,
  badge,
  songId,
}: PredictedSetlistRowProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
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
      <Pressable
        onPress={
          songId
            ? () => router.push(`/songs/${songId}`)
            : undefined
        }
        disabled={!songId}
        accessibilityRole={songId ? 'link' : undefined}
        accessibilityLabel={songId ? `Open song history for ${title}` : undefined}
        testID={songId ? 'predicted-setlist-row-tap' : undefined}
        style={({ pressed }) => [styles.body, songId && pressed ? { opacity: 0.7 } : null]}
      >
        <Text style={[styles.title, { color: colors.ink }]} numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.evidenceRow}>
          <Text
            style={[styles.evidence, { color: colors.muted }]}
            numberOfLines={2}
          >
            {evidence}
          </Text>
          {badge?.firstTime ? (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: colors.accent,
                  borderColor: colors.accent,
                },
              ]}
              testID="predicted-row-badge-first-time"
            >
              <Text
                style={[styles.badgeText, { color: colors.accentText }]}
              >
                🆕 First
              </Text>
            </View>
          ) : null}
          {badge?.rareCatch ? (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: 'transparent',
                  borderColor: colors.accent,
                },
              ]}
              testID="predicted-row-badge-rare"
            >
              <Text style={[styles.badgeText, { color: colors.accent }]}>
                🎯 Rare ({badge.rareCatch.fractionPct}%)
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {STAR_ROLES.has(role) ? (
        <Text
          testID="predicted-row-star"
          style={[styles.star, { color: colors.accent }]}
        >
          ★
        </Text>
      ) : (
        <View style={styles.starSpacer} />
      )}
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
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  evidence: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
  },
  badgeText: {
    fontFamily: 'Geist Mono',
    fontSize: 9.5,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  star: {
    width: 12,
    textAlign: 'center',
    fontSize: 14,
  },
  starSpacer: {
    width: 12,
  },
});
