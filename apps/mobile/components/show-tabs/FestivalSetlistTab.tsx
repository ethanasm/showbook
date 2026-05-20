/**
 * Festival show Setlist tab — chip picker over the lineup with the
 * per-artist Setlist content (predicted upcoming / actual past)
 * rendered below for the selected artist. Mirrors the Discover chip
 * rail UX so the surface feels native.
 *
 * Festival sets are typically shorter than headlining tours, so the
 * underlying prediction is loaded with `prefer: 'festival'` (≤16-song
 * corpus filter) by `setlistIntel.predictedFestivalSetlists`. The
 * "Hype playlist" and "I Heard" cards are scoped to the picked
 * artist; track previews + song badges fan out across every lineup
 * artist's songs via the showId-scoped queries.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../lib/theme';
import { FilterChipsRow, type FilterGroup } from '../FilterChipsRow';
import {
  SetlistTab,
  type ActualSong,
  type AnyPrediction,
} from './SetlistTab';
import {
  sortFestivalLineup,
  type BadgePayload,
  type PreviewMap,
} from '../../lib/setlist-intel';

export interface FestivalLineupSetlistEntry {
  performerId: string;
  performerName: string;
  role: 'headliner' | 'support';
  sortOrder: number;
  prediction: AnyPrediction | null;
  actualSongs: ActualSong[];
}

export interface FestivalSetlistTabProps {
  showId: string;
  isPast: boolean;
  entries: FestivalLineupSetlistEntry[];
  predictionsLoading: boolean;
  badgePayload?: BadgePayload | null;
  trackPreviews?: PreviewMap | null;
  hypePlaylistEnabled?: boolean;
  rotatingDisplayEnabled?: boolean;
  theatricalDisplayEnabled?: boolean;
  improvisedDisplayEnabled?: boolean;
}

export function FestivalSetlistTab(
  props: FestivalSetlistTabProps,
): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { entries, isPast } = props;

  // Default selection: headliner first; fall back to the first lineup
  // entry. The chip rail is required-selection (no "All"), so the
  // initial id is the one chip that opens with content underneath.
  const sortedEntries = React.useMemo(
    () => sortFestivalLineup(entries),
    [entries],
  );

  const defaultId = sortedEntries[0]?.performerId ?? null;
  const [selectedId, setSelectedId] = React.useState<string | null>(defaultId);

  // If the lineup changes (e.g. a new artist was added) and the
  // current selection isn't in it, reset to the headliner.
  React.useEffect(() => {
    if (!selectedId) {
      setSelectedId(defaultId);
      return;
    }
    const stillPresent = sortedEntries.some(
      (e) => e.performerId === selectedId,
    );
    if (!stillPresent) setSelectedId(defaultId);
  }, [defaultId, selectedId, sortedEntries]);

  if (sortedEntries.length === 0) {
    return (
      <View
        testID="festival-setlist-tab-empty"
        style={[
          styles.emptyBox,
          { backgroundColor: colors.surface, borderBottomColor: colors.rule },
        ]}
      >
        <Text style={[styles.emptyTitle, { color: colors.ink }]}>
          No lineup yet
        </Text>
        <Text style={[styles.emptyBody, { color: colors.muted }]}>
          Add artists to the lineup from the Overview tab and we&rsquo;ll
          pull each one&rsquo;s {isPast ? 'setlist from the night' : 'predicted setlist'} here.
        </Text>
      </View>
    );
  }

  const chipGroups: FilterGroup[] = sortedEntries.map((e) => ({
    id: e.performerId,
    name: e.performerName,
    sublabel: e.role === 'headliner' ? 'Headliner' : undefined,
    // Past: show the actual song count. Upcoming: omit the count — the
    // per-artist predicted song count varies by style and we don't
    // want to mislead with a single number.
    count: isPast ? e.actualSongs.length : 0,
  }));

  const selected =
    sortedEntries.find((e) => e.performerId === selectedId) ??
    sortedEntries[0];

  return (
    <View testID="festival-setlist-tab">
      <FilterChipsRow
        groups={chipGroups}
        selected={selected.performerId}
        onSelect={(id) => {
          if (id) setSelectedId(id);
        }}
        showAll={false}
        testIdPrefix="festival-setlist-chip"
      />
      <SetlistTab
        showId={props.showId}
        artistName={selected.performerName}
        isPast={isPast}
        prediction={selected.prediction}
        predictionLoading={props.predictionsLoading}
        actualSongs={selected.actualSongs}
        badgePayload={props.badgePayload}
        trackPreviews={props.trackPreviews}
        hypePlaylistEnabled={props.hypePlaylistEnabled}
        rotatingDisplayEnabled={props.rotatingDisplayEnabled}
        theatricalDisplayEnabled={props.theatricalDisplayEnabled}
        improvisedDisplayEnabled={props.improvisedDisplayEnabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  emptyBox: {
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emptyTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
