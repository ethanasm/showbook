/**
 * Phase 11 §15f — mobile parallel for the set-count strip rendered
 * above the predicted setlist. Renders nothing when the prediction
 * carries no setCountPrediction (corpus too thin to estimate).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../lib/theme';

interface SetCountPredictionLike {
  setCount: number;
  expectedSongCount: { p25: number; p50: number; p75: number };
  expectedDurationMin: number | null;
}

export interface SetCountStripProps {
  prediction: SetCountPredictionLike | null | undefined;
}

export function SetCountStrip({
  prediction,
}: SetCountStripProps): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  if (!prediction) return null;
  const setLabel = prediction.setCount === 1 ? 'set' : 'sets';
  return (
    <View style={styles.row}>
      <Text style={[styles.primary, { color: colors.ink }]}>
        {prediction.setCount} {setLabel}
      </Text>
      <Text style={[styles.sep, { color: colors.faint }]}>·</Text>
      <Text style={[styles.meta, { color: colors.muted }]}>
        ~{prediction.expectedSongCount.p50} songs
      </Text>
      {prediction.expectedDurationMin ? (
        <>
          <Text style={[styles.sep, { color: colors.faint }]}>·</Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            ~{prediction.expectedDurationMin} min
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingVertical: 8,
  },
  primary: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  meta: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sep: {
    fontSize: 11,
  },
});
