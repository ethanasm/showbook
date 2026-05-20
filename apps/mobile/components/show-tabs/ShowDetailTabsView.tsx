/**
 * ShowDetailTabsView (mobile) — Phase 10 4-tab show-detail shell.
 *
 * Mirrors the web `apps/web/components/show-tabs/ShowDetailTabsView.tsx`:
 *  - One Header strip with kind eyebrow, headliner title, date, and
 *    state pill.
 *  - Sticky `ShowTabBar` underneath with per-tab badges (confidence,
 *    count, photo count, notes indicator).
 *  - One tRPC fetch per data dependency (prediction, hype gate, badges,
 *    previews) so the tabs share data and don't double-fetch.
 *  - When the iPad three-pane provider is mounted (`useSelectedShow().
 *    isThreePane`), the right rail is suppressed here — the iPad
 *    layout owns its own rail at the outer level.
 */

import React from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ticket } from 'lucide-react-native';

import { hapticSelection } from '../../lib/haptics';
import { useFeedback } from '../../lib/feedback';

import { useTheme, type Kind, type ShowState } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { CACHE_DEFAULTS } from '../../lib/cache';
import { useQueryClient } from '@tanstack/react-query';
import { runOptimisticMutation } from '../../lib/mutations';
import { getCacheOutbox } from '../../lib/cache/db';
import {
  PreviewPlayerProvider,
} from './TrackPreviewButton';
import { ShowTabBar } from './ShowTabBar';
import { OverviewTab, type OverviewLineupEntry } from './OverviewTab';
import { SetlistTab, type ActualSong, type AnyPrediction } from './SetlistTab';
import { MediaTab } from './MediaTab';
import { NotesTab } from './NotesTab';
import { ShowDetailRightRail } from './ShowDetailRightRail';
import { HypePlaylistCard } from './HypePlaylistCard';
import { KindBadge } from '../KindBadge';
import { StateChip } from '../StateChip';
import { MediaGrid, type MediaGridItem } from '../MediaGrid';
import { Eyebrow, GlowBackdrop, GradientEmphasis, RemoteImage } from '../design-system';
import {
  computeShowTabBadges,
  parseShowTab,
  shouldRenderHypePlaylistCard,
  type ShowTabKey,
} from '../../lib/setlist-intel';
import { useBreakpoint } from '../../lib/responsive';
import { getHeadliner } from '@showbook/shared';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

interface ShowPerformer {
  id: string;
  name: string;
  imageUrl?: string | null;
}
interface ShowPerformerEntry {
  role: 'headliner' | 'support' | 'cast';
  sortOrder: number;
  characterName: string | null;
  performer: ShowPerformer;
}
interface ShowVenue {
  id: string;
  name: string;
  city: string;
  stateRegion: string | null;
}
interface PerformerSetlistSection {
  kind: string;
  songs: { title: string; note?: string | null }[];
}
interface PerformerSetlist {
  sections: PerformerSetlistSection[];
}
export interface ShowDetail {
  id: string;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival' | 'sports' | 'film' | 'unknown';
  state: 'past' | 'ticketed' | 'watching';
  date: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
  tourName: string | null;
  productionName: string | null;
  notes: string | null;
  ticketUrl: string | null;
  venue: ShowVenue;
  showPerformers: ShowPerformerEntry[];
  setlists: Record<string, PerformerSetlist> | null;
}

export interface ShowDetailTabsViewProps {
  show: ShowDetail;
  /** When true, the iPad three-pane is mounting this view in its
   *  middle pane — suppress the inline right rail. */
  embeddedInThreePane?: boolean;
  /** Optional initial tab override (deep link). */
  initialTab?: ShowTabKey;
}

export function ShowDetailTabsView(
  props: ShowDetailTabsViewProps,
): React.JSX.Element {
  return (
    <PreviewPlayerProvider>
      <ShowDetailTabsViewInner {...props} />
    </PreviewPlayerProvider>
  );
}

function ShowDetailTabsViewInner({
  show,
  embeddedInThreePane = false,
  initialTab,
}: ShowDetailTabsViewProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const breakpoint = useBreakpoint();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const isPast = show.state === 'past';

  const [active, setActive] = React.useState<ShowTabKey>(
    parseShowTab(initialTab ?? null),
  );

  const headliner = show.showPerformers.find((sp) => sp.role === 'headliner');
  const resolvedHeadliner = getHeadliner(show);
  const headlinerName = resolvedHeadliner === 'Unknown Artist' ? 'Show' : resolvedHeadliner;

  // ──────────────────────────── tRPC queries ────────────────────────────
  const predictionQuery = trpc.setlistIntel.predictedSetlist.useQuery(
    { showId: show.id },
    {
      enabled: !isPast,
      staleTime: CACHE_DEFAULTS.staleTime,
    },
  );

  const hypeFeatureQuery = trpc.spotify.hypePlaylistFeature.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const hypePlaylistEnabled = Boolean(hypeFeatureQuery.data?.enabled);

  const badgeQuery = trpc.shows.songBadges.useQuery(
    { showId: show.id },
    { enabled: isPast, staleTime: CACHE_DEFAULTS.staleTime },
  );

  const previewsQuery = trpc.setlistIntel.trackPreviewsForShow.useQuery(
    { showId: show.id },
    { staleTime: CACHE_DEFAULTS.staleTime },
  );

  const mediaQuery = trpc.media.listForShow.useQuery(
    { showId: show.id },
    { staleTime: CACHE_DEFAULTS.staleTime },
  );

  // ──────────────────────────── Derived state ────────────────────────────
  const actualSongs: ActualSong[] = React.useMemo(() => {
    if (!isPast) return [];
    if (!headliner) return [];
    const sl = show.setlists?.[headliner.performer.id];
    if (!sl) return [];
    const out: ActualSong[] = [];
    sl.sections.forEach((section, sIdx) => {
      const isEncore = section.kind === 'encore';
      section.songs.forEach((song, songIdx) => {
        out.push({
          title: song.title,
          isEncore,
          isOpenerOrCloser:
            (!isEncore && sIdx === 0 && songIdx === 0) ||
            (!isEncore && songIdx === section.songs.length - 1),
          note: song.note ?? null,
        });
      });
    });
    return out;
  }, [headliner, isPast, show.setlists]);
  const actualSongCount = actualSongs.length;

  const badges = React.useMemo(
    () =>
      computeShowTabBadges({
        isPast,
        predictionConfidence:
          predictionQuery.data && predictionQuery.data.style !== 'cold'
            ? (predictionQuery.data as { confidence: number }).confidence
            : null,
        actualSongCount,
        mediaCount: mediaQuery.data?.length ?? 0,
        notesTrimmedLength: (show.notes ?? '').trim().length,
      }),
    [
      actualSongCount,
      isPast,
      mediaQuery.data?.length,
      predictionQuery.data,
      show.notes,
    ],
  );

  // ──────────────────────────── Mutations ────────────────────────────
  // setNotes runs through the offline outbox so a typed note survives
  // airplane-mode / app-kill. Optimistic patch updates the cached
  // `shows.detail` so the textarea + tab-bar pencil indicator both
  // reflect the new value immediately.
  const saveNotes = React.useCallback(
    async (next: string) => {
      const detailKey = [
        ['shows', 'detail'],
        { input: { showId: show.id }, type: 'query' },
      ];
      type DetailCache = { notes?: string | null } | undefined;
      await runOptimisticMutation({
        mutation: 'shows.setNotes',
        input: { showId: show.id, notes: next },
        outbox: getCacheOutbox(),
        call: (input) => utils.client.shows.setNotes.mutate(input),
        optimistic: {
          snapshot: () => queryClient.getQueryData<DetailCache>(detailKey),
          apply: (input) => {
            queryClient.setQueryData<DetailCache>(detailKey, (prev) =>
              prev ? { ...prev, notes: input.notes } : prev,
            );
          },
          rollback: (snap) => {
            queryClient.setQueryData(detailKey, snap);
          },
        },
        reconcile: () => {
          void utils.shows.detail.invalidate({ showId: show.id });
        },
      });
    },
    [queryClient, show.id, utils],
  );
  const updateState = trpc.shows.updateState.useMutation({
    onSuccess: () => {
      void utils.shows.detail.invalidate({ showId: show.id });
    },
  });
  const deleteShow = trpc.shows.delete.useMutation({
    onSuccess: () => {
      router.replace('/(tabs)/shows');
    },
  });

  // ──────────────────────────── Panels ────────────────────────────
  const overviewCells = React.useMemo(() => {
    const venueLabel = show.venue.name;
    const venueSub = [show.venue.city, show.venue.stateRegion]
      .filter(Boolean)
      .join(', ');
    const seatLabel = show.seat ?? '—';
    const seatSub = show.ticketCount > 1 ? `${show.ticketCount} tix` : '1 tix';
    const priceLabel = show.pricePaid
      ? `$${parseFloat(show.pricePaid).toFixed(0)}`
      : '—';
    const stateLabel = isPast
      ? 'Attended'
      : show.state === 'ticketed'
        ? 'Have tickets'
        : 'Watching';
    return [
      {
        label: 'VENUE',
        value: venueLabel,
        sub: venueSub || undefined,
        onPress: () => router.push(`/venues/${show.venue.id}`),
      },
      { label: 'STATE', value: stateLabel },
      { label: 'PAID', value: priceLabel },
      { label: 'SEAT', value: seatLabel, sub: seatSub },
    ];
  }, [isPast, router, show]);

  const lineupEntries: OverviewLineupEntry[] = React.useMemo(() => {
    return [...show.showPerformers]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((sp) => ({
        performerId: sp.performer.id,
        name: sp.performer.name,
        role: sp.role,
        characterName: sp.characterName,
        imageUrl: sp.performer.imageUrl ?? null,
      }));
  }, [show.showPerformers]);

  const mediaItems: MediaGridItem[] = React.useMemo(
    () =>
      (mediaQuery.data ?? []).map((dto) => {
        const urls = (dto.urls ?? {}) as Record<string, string>;
        const thumbnailUri =
          urls.thumb ??
          urls.large ??
          urls.source ??
          Object.values(urls)[0] ??
          '';
        return {
          id: dto.id,
          thumbnailUri,
          caption: dto.caption,
          tagCount: dto.performerIds?.length ?? 0,
        };
      }),
    [mediaQuery.data],
  );

  const overviewPanel = (
    <OverviewTab
      cells={overviewCells}
      lineup={lineupEntries}
      actions={[
        ...(show.state === 'ticketed'
          ? [
              {
                label: 'Mark attended',
                primary: true,
                testID: 'action-mark-attended',
                onPress: () => {
                  void updateState.mutateAsync({
                    showId: show.id,
                    newState: 'past',
                  });
                },
              },
            ]
          : []),
        {
          label: 'Edit show',
          testID: 'action-edit-show',
          onPress: () => router.push(`/show/${show.id}/edit`),
        },
        {
          label: 'Delete',
          danger: true,
          testID: 'action-delete-show',
          onPress: () => {
            void deleteShow.mutateAsync({ showId: show.id });
          },
        },
      ]}
      isPast={isPast}
      onOpenPerformer={(id) => router.push(`/artists/${id}`)}
      // FanLoyaltyRing (Phase 7) plugs in here once it ports to mobile.
      // Until then the slot stays empty rather than teasing the feature
      // with a placeholder card.
      musicLayerSlot={null}
    />
  );

  const setlistPanel = (
    <SetlistTab
      showId={show.id}
      artistName={headlinerName}
      isPast={isPast}
      prediction={(predictionQuery.data as AnyPrediction | undefined) ?? null}
      predictionLoading={predictionQuery.isLoading}
      actualSongs={actualSongs}
      badgePayload={badgeQuery.data ?? null}
      trackPreviews={previewsQuery.data?.previews ?? null}
      hypePlaylistEnabled={hypePlaylistEnabled}
      rotatingDisplayEnabled
      theatricalDisplayEnabled
      improvisedDisplayEnabled
    />
  );

  const mediaPanel = (
    <MediaTab
      isPast={isPast}
      mediaCount={mediaQuery.data?.length ?? 0}
      photoGrid={
        <MediaGrid
          items={mediaItems}
          showId={show.id}
          canUpload={isPast}
          loading={mediaQuery.isLoading}
        />
      }
    />
  );

  const notesPanel = (
    <NotesTab
      isPast={isPast}
      notes={show.notes ?? ''}
      onSave={saveNotes}
    />
  );

  // Right rail (iPad only when not embedded already, since the iPad
  // three-pane mounts its rail at the outer level).
  const showInlineRail =
    breakpoint === 'tablet' && !embeddedInThreePane;
  const railHypeMeta = React.useMemo(() => {
    if (!hypePlaylistEnabled) return null;
    if (isPast) return null;
    const prediction = predictionQuery.data as AnyPrediction | undefined;
    if (!prediction) return null;
    if (
      !shouldRenderHypePlaylistCard({
        isPast,
        predictionStyle: prediction.style,
      })
    ) {
      return null;
    }
    if (prediction.style === 'stable') {
      const total = prediction.core.length;
      return { count: total, approxMinutes: total > 0 ? Math.round(total * 4) : null };
    }
    if (prediction.style === 'theatrical') {
      const total =
        prediction.deterministicSetlist.length +
        prediction.rotatingSlots.length;
      return {
        count: total,
        approxMinutes: total > 0 ? Math.round(total * 4) : null,
      };
    }
    return null;
  }, [hypePlaylistEnabled, isPast, predictionQuery.data]);

  const rightRailSlots = {
    hypePlaylistCard: railHypeMeta ? (
      <HypePlaylistCard
        showId={show.id}
        artist={headlinerName}
        kind="hype"
        trackCount={railHypeMeta.count}
        approxMinutes={railHypeMeta.approxMinutes}
      />
    ) : null,
    // FanLoyaltyRing pending port from web (Phase 7 follow-up).
    fanLoyaltyRing: null,
  };

  // Pull-to-refresh: refetch the per-show queries that drive each tab
  // plus the canonical shows.detail (so a stale state pill / setlist
  // upstream change picks up). Cheap to over-refetch — every query
  // here is per-show and React Query dedupes in-flight requests.
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        utils.shows.detail.invalidate({ showId: show.id }),
        predictionQuery.refetch(),
        badgeQuery.refetch(),
        previewsQuery.refetch(),
        mediaQuery.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [
    badgeQuery,
    mediaQuery,
    predictionQuery,
    previewsQuery,
    show.id,
    utils,
  ]);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.body}>
        <HeaderStrip show={show} />
        <ShowTabBar active={active} badges={badges} onSelect={setActive} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.muted}
            />
          }
        >
          {active === 'overview' ? overviewPanel : null}
          {active === 'setlist' ? setlistPanel : null}
          {active === 'media' ? mediaPanel : null}
          {active === 'notes' ? notesPanel : null}
        </ScrollView>
      </View>
      {showInlineRail ? (
        <ShowDetailRightRail isPast={isPast} slots={rightRailSlots} />
      ) : null}
    </View>
  );
}

function HeaderStrip({ show }: { show: ShowDetail }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { showToast } = useFeedback();
  const resolvedHeadliner = getHeadliner(show);
  const title = resolvedHeadliner === 'Unknown Artist' ? 'Untitled' : resolvedHeadliner;
  const date = parseDate(show.date);
  const showTicketAction =
    Boolean(show.ticketUrl) &&
    (show.state === 'watching' || show.state === 'ticketed');

  // Gradient-emphasis the last word of the title for a touch of editorial flair.
  const parts = title.trim().split(/\s+/);
  const head = parts.length > 1 ? parts.slice(0, -1).join(' ') + ' ' : '';
  const tail = parts.length > 1 ? (parts[parts.length - 1] as string) : title;
  const venueLine = [show.venue.name, show.venue.city].filter(Boolean).join(' · ');

  // Headliner image is shown only for solo-artist kinds (concert/comedy)
  // where the title maps 1:1 to a single performer. Festivals span many
  // artists and theatre titles are productions, so the avatar would
  // mislead more than it'd help.
  const showHeadlinerImage = show.kind === 'concert' || show.kind === 'comedy';
  const headliner = show.showPerformers.find((sp) => sp.role === 'headliner');
  const headlinerImageUrl = headliner?.performer.imageUrl ?? null;
  const headlinerImageName = headliner?.performer.name ?? title;

  return (
    <View
      testID="show-tabs-header"
      style={[styles.header, { borderBottomColor: colors.rule }]}
    >
      <GlowBackdrop grid={false} />
      <View style={styles.headerContent}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextCol}>
            <Eyebrow>
              {show.kind === 'theatre' ? 'THEATRE' : show.kind.toUpperCase()}
              {date ? ` · ${date}` : ''}
            </Eyebrow>
            <View style={styles.headerChips}>
              <KindBadge kind={show.kind as Kind} size="sm" />
              {show.state !== 'past' ? (
                <StateChip state={show.state as ShowState} />
              ) : (
                <View
                  testID="went-badge"
                  style={[
                    styles.wentBadge,
                    { borderColor: colors.ruleStrong },
                  ]}
                >
                  <Text style={[styles.wentBadgeText, { color: colors.muted }]}>
                    WENT
                  </Text>
                </View>
              )}
              {showTicketAction && show.ticketUrl ? (
                <Pressable
                  onPress={() => {
                    void hapticSelection();
                    Linking.openURL(show.ticketUrl as string).catch(() => {
                      showToast({
                        kind: 'error',
                        text: "Couldn't open Ticketmaster.",
                      });
                    });
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Open tickets on Ticketmaster"
                  testID="show-header-tickets"
                  style={({ pressed }) => [
                    styles.ticketAction,
                    { borderColor: colors.rule, backgroundColor: colors.surface },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Ticket size={14} color={colors.muted} strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>
            <Text
              style={[styles.headerTitle, { color: colors.ink }]}
              numberOfLines={2}
            >
              {head ? <Text>{head}</Text> : null}
              <GradientEmphasis style={[styles.headerTitle, { color: colors.accent }]}>
                {tail}
              </GradientEmphasis>
            </Text>
            {show.tourName ? (
              <Text style={[styles.headerSub, { color: colors.muted }]} numberOfLines={1}>
                {show.tourName}
              </Text>
            ) : null}
            {venueLine ? (
              <Pressable
                onPress={() => router.push(`/venues/${show.venue.id}`)}
                accessibilityRole="link"
                accessibilityLabel={`Open ${show.venue.name}`}
                hitSlop={6}
                style={({ pressed }) => [styles.headerVenueLink, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.headerVenue, { color: colors.muted }]} numberOfLines={1}>
                  {venueLine}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {showHeadlinerImage ? (
            <Pressable
              testID="show-tabs-header-headliner-image"
              onPress={() =>
                headliner
                  ? router.push(`/artists/${headliner.performer.id}`)
                  : undefined
              }
              disabled={!headliner}
              accessibilityRole={headliner ? 'link' : 'image'}
              accessibilityLabel={headlinerImageName}
              style={({ pressed }) => [
                styles.headerImageWrap,
                pressed && headliner ? { opacity: 0.85 } : null,
              ]}
            >
              <RemoteImage
                uri={headlinerImageUrl}
                name={headlinerImageName}
                kind={show.kind as Kind}
                size="custom"
                width={84}
                height={84}
                aspect="1/1"
                style={styles.headerImage}
              />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function parseDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  const month = MONTHS[monthIdx] ?? '';
  return `${month} ${day}, ${year}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  scroll: {
    paddingBottom: 48,
  },
  header: {
    position: 'relative',
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 18,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  headerTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  headerImageWrap: {
    marginTop: 2,
  },
  headerImage: {
    borderRadius: 14,
  },
  headerChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontFamily: 'Georgia',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
    lineHeight: 32,
  },
  headerSub: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
  },
  headerVenueLink: {
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  headerVenue: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
  },
  wentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
  },
  wentBadgeText: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.4,
  },
  ticketAction: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
