/**
 * SetlistTab (mobile) — pre-show: confidence banner + (when not hidden
 * by SI-05) HypePlaylistCard + the prediction-style-specific subtree.
 * Post-show: actual setlist with inline song badges + I-Heard playlist
 * card.
 *
 * The routing logic lives in `lib/setlist-intel/style-switcher.ts` so
 * the unit suite can assert the predicate behaviour without RN.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../lib/theme';
import { SectionFrame } from './SectionFrame';
import { HypePlaylistCard } from './HypePlaylistCard';
import { StableSetlistView } from './StableSetlistView';
import {
  RotatingGateBlocked,
  RotatingSetlistView,
  type RotatingPredictionLike,
} from './RotatingSetlistView';
import {
  TheatricalGateBlocked,
  TheatricalSetlistView,
  type TheatricalPredictionLike,
} from './TheatricalSetlistView';
import {
  ImprovisedGateBlocked,
  ImprovisedSetlistView,
  type ImprovisedPredictionLike,
} from './ImprovisedSetlistView';
import { PlayedCountBanner } from './ConfidenceBanner';
import { PredictedSetlistRow } from './PredictedSetlistRow';
import { EncoreDivider } from './EncoreDivider';
import { SetCountStrip } from './SetCountStrip';
import { SpecialEventCard } from './SpecialEventCard';
import {
  pickSetlistView,
  resolveBadge,
  resolvePreview,
  shouldRenderHypePlaylistCard,
  type BadgePayload,
  type PreviewMap,
} from '../../lib/setlist-intel';

export interface ActualSong {
  title: string;
  isEncore: boolean;
  isOpenerOrCloser?: boolean;
  note?: string | null;
}

// Loose superset of every prediction shape — the parent passes through
// `predictedSetlist` whatever the server returned.
export type AnyPrediction =
  | { style: 'cold'; reason: string; performerName?: string | null }
  | {
      style: 'stable';
      confidence: number;
      sampleSize: number;
      tourName: string | null;
      core: {
        title: string;
        evidence: string;
        role: 'opener' | 'closer' | 'encore_open' | 'encore_close' | 'core';
      }[];
      setCountPrediction?: SetCountPredictionShape | null;
    }
  | RotatingPredictionLike
  | TheatricalPredictionLike
  | ImprovisedPredictionLike
  // Phase 11 §15g — special-event empty-state variant. When the
  // server matches a special_event_rules row, the predicted-setlist
  // surface replaces every other shape.
  | {
      style: 'special_event';
      copy: string;
      pastEvents: ReadonlyArray<{
        date: string;
        performanceDate: string;
        venueName: string | null;
        songCount: number;
      }>;
    };

interface SetCountPredictionShape {
  setCount: number;
  setCountConfidence: number;
  expectedSongCount: { p25: number; p50: number; p75: number };
  expectedDurationMin: number | null;
}

export interface SetlistTabProps {
  showId: string;
  artistName: string;
  isPast: boolean;
  prediction: AnyPrediction | null;
  predictionLoading: boolean;
  actualSongs?: ActualSong[];
  badgePayload?: BadgePayload | null;
  trackPreviews?: PreviewMap | null;
  hypePlaylistEnabled?: boolean;
  rotatingDisplayEnabled?: boolean;
  theatricalDisplayEnabled?: boolean;
  improvisedDisplayEnabled?: boolean;
}

export function SetlistTab(props: SetlistTabProps): React.JSX.Element {
  if (props.isPast) return <SetlistTabPast {...props} />;
  return <SetlistTabUpcoming {...props} />;
}

// ------------------------------------------------------------------
// Upcoming
// ------------------------------------------------------------------

function SetlistTabUpcoming(props: SetlistTabProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const {
    showId,
    artistName,
    prediction,
    predictionLoading,
    trackPreviews,
    hypePlaylistEnabled,
    rotatingDisplayEnabled,
    theatricalDisplayEnabled,
    improvisedDisplayEnabled,
  } = props;

  if (predictionLoading) {
    return <LoadingState />;
  }

  if (!prediction || prediction.style === 'cold') {
    return (
      <ColdState
        reason={prediction?.style === 'cold' ? prediction.reason : 'no_corpus'}
        artistName={
          prediction?.style === 'cold' && prediction.performerName
            ? prediction.performerName
            : artistName
        }
      />
    );
  }

  // Phase 11 §15g — special-event short-circuit (mobile parallel).
  if (prediction.style === 'special_event') {
    return (
      <SpecialEventCard
        copy={prediction.copy}
        pastEvents={prediction.pastEvents}
      />
    );
  }

  const view = pickSetlistView(
    { style: prediction.style },
    {
      rotatingDisplayEnabled,
      theatricalDisplayEnabled,
      improvisedDisplayEnabled,
    },
  );

  // SI-05 hide rule for hype playlist.
  const showHype =
    hypePlaylistEnabled === true &&
    shouldRenderHypePlaylistCard({
      isPast: false,
      predictionStyle: prediction.style,
    });

  let hypeMeta: { count: number; approxMinutes: number | null } | null = null;
  if (prediction.style === 'stable') {
    const total = prediction.core.length;
    hypeMeta = {
      count: total,
      approxMinutes: total > 0 ? Math.round(total * 4) : null,
    };
  } else if (prediction.style === 'theatrical') {
    const total =
      prediction.deterministicSetlist.length + prediction.rotatingSlots.length;
    hypeMeta = {
      count: total,
      approxMinutes: total > 0 ? Math.round(total * 4) : null,
    };
  }

  // Phase 11 §15f — set-count strip rendered above the predicted
  // setlist on every style that produced one.
  const setCountPrediction =
    'setCountPrediction' in prediction ? prediction.setCountPrediction : null;

  return (
    <View>
      <SetCountStrip prediction={setCountPrediction ?? null} />
      {showHype && hypeMeta ? (
        <SectionFrame title="Hype playlist">
          <HypePlaylistCard
            showId={showId}
            artist={artistName}
            kind="hype"
            trackCount={hypeMeta.count}
            approxMinutes={hypeMeta.approxMinutes}
          />
        </SectionFrame>
      ) : null}
      {view === 'stable' && prediction.style === 'stable' ? (
        <StableSetlistView
          prediction={prediction}
          showId={showId}
          trackPreviews={trackPreviews}
        />
      ) : null}
      {view === 'rotating' && prediction.style === 'rotating' ? (
        <RotatingSetlistView prediction={prediction} />
      ) : null}
      {view === 'rotating_blocked' ? <RotatingGateBlocked /> : null}
      {view === 'theatrical' && prediction.style === 'theatrical' ? (
        <TheatricalSetlistView prediction={prediction} />
      ) : null}
      {view === 'theatrical_blocked' ? <TheatricalGateBlocked /> : null}
      {view === 'improvised' && prediction.style === 'improvised' ? (
        <ImprovisedSetlistView prediction={prediction} />
      ) : null}
      {view === 'improvised_blocked' ? <ImprovisedGateBlocked /> : null}
      <Text style={[styles.lockNote, { color: colors.faint }]}>
        Setlist locks in after the show. We&rsquo;ll auto-pull the actual
        songs from setlist.fm and offer a &ldquo;save tonight to Spotify
        &rdquo; button.
      </Text>
    </View>
  );
}

// ------------------------------------------------------------------
// Past
// ------------------------------------------------------------------

function SetlistTabPast({
  showId,
  artistName,
  actualSongs = [],
  badgePayload,
  trackPreviews,
  hypePlaylistEnabled,
}: SetlistTabProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const main = actualSongs.filter((s) => !s.isEncore);
  const encore = actualSongs.filter((s) => s.isEncore);
  const total = actualSongs.length;
  const approxMinutes = total > 0 ? Math.round(total * 4) : null;

  if (total === 0) {
    return (
      <View
        testID="setlist-tab-past-empty"
        style={[
          styles.coldBox,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.rule,
          },
        ]}
      >
        <Text style={[styles.coldTitle, { color: colors.ink }]}>
          Setlist not in yet
        </Text>
        <Text style={[styles.coldBody, { color: colors.muted }]}>
          We&rsquo;ll auto-import {artistName}&rsquo;s setlist from
          setlist.fm during the next nightly run. You can also paste it in
          manually from the Edit panel.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <PlayedCountBanner total={total} />
      {hypePlaylistEnabled ? (
        <SectionFrame title={`I Heard ${artistName}`}>
          <HypePlaylistCard
            showId={showId}
            artist={artistName}
            kind="heard"
            trackCount={total}
            approxMinutes={approxMinutes}
          />
        </SectionFrame>
      ) : null}
      <SectionFrame title="Setlist" count={total}>
        <View testID="actual-setlist-grid">
          {main.map((song, idx) => {
            const resolved = resolveBadge(song.title, badgePayload);
            const preview = resolvePreview(song.title, trackPreviews);
            return (
              <PredictedSetlistRow
                key={`main-${idx}-${song.title}`}
                position={idx + 1}
                title={song.title}
                evidence={song.note ?? 'actual · setlist.fm'}
                role={
                  song.isOpenerOrCloser
                    ? idx === 0
                      ? 'opener'
                      : 'closer'
                    : 'core'
                }
                showId={showId}
                previewUrl={preview.previewUrl}
                spotifyTrackId={preview.spotifyTrackId}
                badge={resolved.badge}
              />
            );
          })}
          {encore.length > 0 ? (
            <>
              <EncoreDivider />
              {encore.map((song, idx) => {
                const resolved = resolveBadge(song.title, badgePayload);
                const preview = resolvePreview(song.title, trackPreviews);
                return (
                  <PredictedSetlistRow
                    key={`encore-${idx}-${song.title}`}
                    position={idx + 1}
                    title={song.title}
                    evidence={song.note ?? 'actual · encore'}
                    role={
                      idx === 0
                        ? 'encore_open'
                        : idx === encore.length - 1
                          ? 'encore_close'
                          : 'core'
                    }
                    showId={showId}
                    previewUrl={preview.previewUrl}
                    spotifyTrackId={preview.spotifyTrackId}
                    badge={resolved.badge}
                  />
                );
              })}
            </>
          ) : null}
        </View>
      </SectionFrame>
    </View>
  );
}

function LoadingState(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View testID="setlist-tab-loading" style={styles.loading}>
      {Array.from({ length: 6 }).map((_, i) => (
        <View
          key={`skeleton-${i}`}
          style={[
            styles.skeleton,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        />
      ))}
    </View>
  );
}

function ColdState({
  reason,
  artistName,
}: {
  reason: string;
  artistName: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const copy = coldCopy(reason, artistName);
  return (
    <View
      testID={`setlist-tab-cold-${reason}`}
      style={[
        styles.coldBox,
        { backgroundColor: colors.surface, borderBottomColor: colors.rule },
      ]}
    >
      <Text style={[styles.coldTitle, { color: colors.ink }]}>
        {copy.title}
      </Text>
      <Text style={[styles.coldBody, { color: colors.muted }]}>
        {copy.body}
      </Text>
    </View>
  );
}

function coldCopy(
  reason: string,
  artistName: string,
): { title: string; body: string } {
  switch (reason) {
    case 'no_mbid':
      return {
        title: "We can't pull recent setlists for this performer",
        body: `${artistName} isn't in the MusicBrainz database we use as the ID source. We'll keep trying to match on the nightly enrichment pass.`,
      };
    case 'no_corpus':
      return {
        title: "We're pulling recent setlists",
        body: `Hang tight while we fetch ${artistName}'s recent shows from setlist.fm. Check back in a few hours.`,
      };
    case 'date_not_set':
      return {
        title: 'Pick a night',
        body: "Once you commit to a date for this run, we'll show the predicted setlist for that specific night.",
      };
    case 'wrong_kind':
      return {
        title: 'Predicted setlists are for concerts + festivals',
        body: "Comedy, theatre, sports, and film shows don't have rotating setlist semantics — we skip the prediction for these.",
      };
    case 'production_show':
      return {
        title: 'Production show — no rotating setlist',
        body: 'Theatre and festival production runs follow a script rather than a setlist.',
      };
    case 'no_headliner':
      return {
        title: 'No headliner on this show',
        body: "We can't predict a setlist without a headliner performer.",
      };
    default:
      return {
        title: 'Not enough data yet',
        body: 'The prediction will populate once we have a recent setlist for this artist.',
      };
  }
}

const styles = StyleSheet.create({
  lockNote: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.3,
    lineHeight: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  coldBox: {
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  coldTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  coldBody: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 380,
  },
  loading: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 10,
  },
  skeleton: {
    height: 36,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
