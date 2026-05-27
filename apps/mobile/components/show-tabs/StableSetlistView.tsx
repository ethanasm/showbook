/**
 * StableSetlistView (mobile) — main-set + encore rendering for a stable
 * `predictedSetlist` payload. Built around the predicted-row primitive
 * so a single mounting point gets the per-row TrackPreview button +
 * inline song badges.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { ConfidenceBanner } from './ConfidenceBanner';
import { SectionFrame } from './SectionFrame';
import { PredictedSetlistRow } from './PredictedSetlistRow';
import { EncoreDivider } from './EncoreDivider';
import {
  resolvePreview,
  type PreviewMap,
} from '@/lib/setlist-intel';

export interface StablePredictionLike {
  style: 'stable';
  confidence: number;
  /** Optional one-sentence rationale for the confidence number,
   *  rendered as subcopy under the banner. Older cached payloads may
   *  omit this — keep it optional so legacy fixtures still render. */
  confidenceNote?: string | null;
  sampleSize: number;
  tourName: string | null;
  core: {
    title: string;
    evidence: string;
    role: 'opener' | 'closer' | 'encore_open' | 'encore_close' | 'core';
  }[];
  /** Songs with 0.35 ≤ probability < 0.65. Rendered alongside `core`
   *  so the "Likely setlist" shows a fuller set rather than only the
   *  near-certain (≥0.65) songs — see SetlistTab notes on the web.
   *  Optional so legacy cached payloads (or test fixtures that
   *  pre-date this field) still render without throwing. */
  likely?: {
    title: string;
    evidence: string;
    role: 'opener' | 'closer' | 'encore_open' | 'encore_close' | 'core';
  }[];
}

interface StableSetlistViewProps {
  prediction: StablePredictionLike;
  showId: string;
  trackPreviews?: PreviewMap | null;
}

export function StableSetlistView({
  prediction,
  showId,
  trackPreviews,
}: StableSetlistViewProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  // Render core + likely together so the "Likely setlist" surfaces a
  // full predicted set rather than only the ≥0.65 core. With a small
  // corpus the Bayesian smoothing keeps most songs under 0.65; showing
  // only `core` would clip the prediction to the few near-certain
  // songs. The evidence string ("N of last M shows") already
  // differentiates strength to the reader.
  const allLikely = [...prediction.core, ...(prediction.likely ?? [])];
  const main = allLikely.filter(
    (s) => s.role !== 'encore_open' && s.role !== 'encore_close',
  );
  const encore = allLikely.filter(
    (s) => s.role === 'encore_open' || s.role === 'encore_close',
  );
  const total = main.length + encore.length;
  return (
    <View testID="stable-setlist-view">
      <ConfidenceBanner
        confidence={prediction.confidence}
        sampleSize={prediction.sampleSize}
        tourName={prediction.tourName}
        archetype="STABLE"
        subCopy={prediction.confidenceNote ?? undefined}
      />
      <SectionFrame title="Likely setlist" count={total}>
        <View testID="predicted-setlist-grid">
          {main.map((song, idx) => {
            const preview = resolvePreview(song.title, trackPreviews);
            return (
              <PredictedSetlistRow
                key={`main-${idx}-${song.title}`}
                position={idx + 1}
                title={song.title}
                evidence={song.evidence}
                role={song.role}
                showId={showId}
                previewUrl={preview.previewUrl}
                spotifyTrackId={preview.spotifyTrackId}
              />
            );
          })}
          {encore.length > 0 ? (
            <>
              <EncoreDivider />
              {encore.map((song, idx) => {
                const preview = resolvePreview(song.title, trackPreviews);
                return (
                  <PredictedSetlistRow
                    key={`encore-${idx}-${song.title}`}
                    position={idx + 1}
                    title={song.title}
                    evidence={song.evidence}
                    role={song.role}
                    showId={showId}
                    previewUrl={preview.previewUrl}
                    spotifyTrackId={preview.spotifyTrackId}
                  />
                );
              })}
            </>
          ) : null}
        </View>
        {total === 0 ? (
          <Text style={[styles.thin, { color: colors.muted }]}>
            Not enough confidence in the predicted set to surface specific
            songs yet — we&rsquo;ll backfill as more recent setlists land.
          </Text>
        ) : null}
      </SectionFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  thin: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
    lineHeight: 17,
  },
});
