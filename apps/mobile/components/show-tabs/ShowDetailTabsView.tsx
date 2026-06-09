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
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bookmark,
  Check,
  ChevronLeft,
  Eye,
  MoreHorizontal,
  Ticket,
} from 'lucide-react-native';

import { hapticSelection } from '@/lib/haptics';
import { useFeedback } from '@/lib/feedback';

import { useAuth } from '@/lib/auth';
import { showCoverImageSource, venueImageSource } from '@/lib/images';
import { useTheme, type Kind, type ShowState } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { CACHE_DEFAULTS } from '@/lib/cache';
import { useQueryClient } from '@tanstack/react-query';
import { runOptimisticMutation } from '@/lib/mutations';
import { getCacheOutbox } from '@/lib/cache/db';
import { ShowTabBar } from './ShowTabBar';
import { MarkTicketedSheet } from '../MarkTicketedSheet';
import { OverviewTab, type OverviewLineupEntry } from './OverviewTab';
import { SetlistTab, type ActualSong, type AnyPrediction } from './SetlistTab';
import {
  FestivalSetlistTab,
  type FestivalLineupSetlistEntry,
} from './FestivalSetlistTab';
import { MediaTab } from './MediaTab';
import { NotesTab } from './NotesTab';
import { ShowDetailRightRail } from './ShowDetailRightRail';
import { HypePlaylistCard } from './HypePlaylistCard';
import { KindBadge } from '../KindBadge';
import { MediaGrid, type MediaGridItem } from '../MediaGrid';
import { RemoteImage } from '../design-system';
import {
  computeShowTabBadges,
  parseShowTab,
  shouldRenderHypePlaylistCard,
  type ShowTabKey,
} from '@/lib/setlist-intel';
import { useBreakpoint } from '@/lib/responsive';
import {
  buildActualSongsFromSetlist,
  buildFestivalLineupEntries,
  countFestivalActualSongs,
  formatDateRangeShort,
  formatVenueLocation,
  getHeadliner,
  hasProductionLabel,
  isVenuePlaceholder,
} from '@showbook/shared';

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
  photoUrl?: string | null;
  googlePlaceId?: string | null;
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
  kind: 'concert' | 'theatre' | 'comedy' | 'festival' | 'film' | 'unknown';
  state: 'past' | 'ticketed' | 'watching';
  date: string | null;
  endDate: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
  tourName: string | null;
  productionName: string | null;
  coverImageUrl: string | null;
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
  /** Floating hero chrome callbacks. When provided, `HeaderStrip` renders
   *  glass-pill back / more buttons over the photo so the screen-level
   *  TopBar can be suppressed. */
  onBack?: () => void;
  onMore?: () => void;
}

export function ShowDetailTabsView({
  show,
  embeddedInThreePane = false,
  initialTab,
  onBack,
  onMore,
}: ShowDetailTabsViewProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const breakpoint = useBreakpoint();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();
  const isPast = show.state === 'past';
  const isFestival = show.kind === 'festival';
  const showTicketAction =
    Boolean(show.ticketUrl) &&
    (show.state === 'watching' || show.state === 'ticketed');

  // Only concerts + festivals have rotating setlist semantics — other
  // kinds drop the Setlist tab entirely (matches the web shell).
  const hiddenTabs = React.useMemo<readonly ShowTabKey[]>(
    () =>
      show.kind === 'concert' || show.kind === 'festival' ? [] : ['setlist'],
    [show.kind],
  );
  const isTabHidden = React.useCallback(
    (key: ShowTabKey) => hiddenTabs.includes(key),
    [hiddenTabs],
  );

  const [active, setActive] = React.useState<ShowTabKey>(() => {
    const parsed = parseShowTab(initialTab ?? null);
    return hiddenTabs.includes(parsed) ? 'overview' : parsed;
  });
  // If the show kind changes such that the active tab gets hidden
  // (e.g. user edits a concert to a theatre), fall back to overview.
  React.useEffect(() => {
    if (hiddenTabs.includes(active)) setActive('overview');
  }, [active, hiddenTabs]);
  const [markTicketedOpen, setMarkTicketedOpen] = React.useState(false);

  const headliner = show.showPerformers.find((sp) => sp.role === 'headliner');
  const resolvedHeadliner = getHeadliner(show);
  const headlinerName = resolvedHeadliner === 'Unknown Artist' ? 'Show' : resolvedHeadliner;

  // ──────────────────────────── tRPC queries ────────────────────────────
  // Festivals use the multi-artist procedure; everything else uses the
  // headliner-only one. Mutually-exclusive `enabled` keeps the query
  // pair from double-fetching.
  const predictionQuery = trpc.setlistIntel.predictedSetlist.useQuery(
    { showId: show.id },
    {
      enabled: !isPast && !isFestival,
      staleTime: CACHE_DEFAULTS.staleTime,
    },
  );
  const festivalPredictionsQuery =
    trpc.setlistIntel.predictedFestivalSetlists.useQuery(
      { showId: show.id },
      {
        enabled: !isPast && isFestival,
        staleTime: CACHE_DEFAULTS.staleTime,
      },
    );

  const hypePlaylistEnabled = true;

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
    if (!isPast || !headliner) return [];
    return buildActualSongsFromSetlist(show.setlists?.[headliner.performer.id]);
  }, [headliner, isPast, show.setlists]);
  const actualSongCount = actualSongs.length;

  // For festivals, build one entry per lineup artist. Past = pull
  // each performer's setlist from the per-performer map. Upcoming =
  // pull each artist's prediction from the festival procedure's
  // entries (keyed by performerId).
  const festivalLineupSetlists: FestivalLineupSetlistEntry[] = React.useMemo(() => {
    if (!isFestival) return [];
    return buildFestivalLineupEntries<AnyPrediction>({
      showPerformers: show.showPerformers,
      isPast,
      predictions:
        !isPast && festivalPredictionsQuery.data?.entries
          ? festivalPredictionsQuery.data.entries.map((e) => ({
              performerId: e.performerId,
              prediction: e.prediction as AnyPrediction,
            }))
          : null,
      setlistsByPerformer: show.setlists ?? {},
    });
  }, [
    festivalPredictionsQuery.data,
    isFestival,
    isPast,
    show.setlists,
    show.showPerformers,
  ]);

  const festivalActualSongCount = React.useMemo(
    () =>
      countFestivalActualSongs({
        isFestival,
        isPast,
        entries: festivalLineupSetlists,
      }),
    [festivalLineupSetlists, isFestival, isPast],
  );

  // Festival predictions are an array. The tab-bar badge is a single
  // confidence number, so reduce to the headliner's confidence when
  // the headliner entry produced a hot prediction; otherwise drop the
  // badge for upcoming festivals.
  const festivalHeadlinerConfidence: number | null = React.useMemo(() => {
    if (!isFestival || isPast) return null;
    const entries = festivalPredictionsQuery.data?.entries;
    if (!entries || entries.length === 0) return null;
    const headlinerEntry = entries.find((e) => e.role === 'headliner');
    const p = headlinerEntry?.prediction;
    if (!p || p.style === 'cold') return null;
    return (p as { confidence?: number }).confidence ?? null;
  }, [festivalPredictionsQuery.data, isFestival, isPast]);

  const badges = React.useMemo(
    () =>
      computeShowTabBadges({
        isPast,
        predictionConfidence: isFestival
          ? festivalHeadlinerConfidence
          : predictionQuery.data && predictionQuery.data.style !== 'cold'
            ? (predictionQuery.data as { confidence: number }).confidence
            : null,
        actualSongCount: isFestival ? festivalActualSongCount : actualSongCount,
        mediaCount: mediaQuery.data?.length ?? 0,
        notesTrimmedLength: (show.notes ?? '').trim().length,
      }),
    [
      actualSongCount,
      festivalActualSongCount,
      festivalHeadlinerConfidence,
      isFestival,
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
  // Delete is irreversible, so the Overview "Delete" pill confirms via
  // Alert.alert before firing — mirroring ShowActionSheet.askDelete (and
  // the web DeleteShowConfirmModal) so both delete entry points on the
  // detail screen get a Cancel / Delete prompt.
  const confirmDelete = React.useCallback(() => {
    Alert.alert(
      'Delete this show?',
      'This removes the show, its setlists, and any tagged media. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteShow.mutateAsync({ showId: show.id });
          },
        },
      ],
    );
  }, [deleteShow, show.id]);

  // ──────────────────────────── Panels ────────────────────────────
  const overviewCells = React.useMemo(() => {
    const venueLabel = show.venue.name;
    const venueSub = formatVenueLocation(show.venue);
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
      lineupLabel={show.kind === 'theatre' ? 'Cast' : 'Lineup'}
      actions={[
        ...(show.state === 'watching'
          ? [
              {
                label: 'I have tickets',
                primary: true,
                testID: 'action-mark-ticketed',
                onPress: () => setMarkTicketedOpen(true),
              },
            ]
          : []),
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
        ...(showTicketAction && show.ticketUrl
          ? [
              {
                label: 'Tickets',
                testID: 'action-open-tickets',
                icon: <Ticket size={14} color={colors.ink} strokeWidth={2} />,
                onPress: () => {
                  void hapticSelection();
                  Linking.openURL(show.ticketUrl as string).catch(() => {
                    showToast({
                      kind: 'error',
                      text: "Couldn't open Ticketmaster.",
                    });
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
          onPress: confirmDelete,
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

  const setlistPanel = isFestival ? (
    <FestivalSetlistTab
      showId={show.id}
      isPast={isPast}
      entries={festivalLineupSetlists}
      predictionsLoading={festivalPredictionsQuery.isLoading}
      badgePayload={badgeQuery.data ?? null}
      trackPreviews={previewsQuery.data?.previews ?? null}
      hypePlaylistEnabled={hypePlaylistEnabled}
    />
  ) : (
    <SetlistTab
      showId={show.id}
      performerId={headliner?.performer.id ?? ''}
      artistName={headlinerName}
      isPast={isPast}
      prediction={(predictionQuery.data as AnyPrediction | undefined) ?? null}
      predictionLoading={predictionQuery.isLoading}
      actualSongs={actualSongs}
      badgePayload={badgeQuery.data ?? null}
      trackPreviews={previewsQuery.data?.previews ?? null}
      hypePlaylistEnabled={hypePlaylistEnabled}
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
      showId={show.id}
      venueId={show.venue.id}
      setlistSongCount={actualSongCount}
      hypePlaylistEnabled={hypePlaylistEnabled}
      onSwitchToSetlistTab={() => setActive('setlist')}
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
    hypePlaylistCard: railHypeMeta && headliner ? (
      <HypePlaylistCard
        showId={show.id}
        performerId={headliner.performer.id}
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
        <HeaderStrip show={show} onBack={onBack} onMore={onMore} />
        <ShowTabBar
          active={active}
          badges={badges}
          onSelect={setActive}
          hiddenTabs={hiddenTabs}
        />
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
          {active === 'setlist' && !isTabHidden('setlist') ? setlistPanel : null}
          {active === 'media' ? mediaPanel : null}
          {active === 'notes' ? notesPanel : null}
        </ScrollView>
      </View>
      {showInlineRail ? (
        <ShowDetailRightRail isPast={isPast} slots={rightRailSlots} />
      ) : null}
      <MarkTicketedSheet
        open={markTicketedOpen}
        onClose={() => setMarkTicketedOpen(false)}
        showId={show.id}
        initialSeat={show.seat}
        initialPrice={show.pricePaid}
        initialTicketCount={show.ticketCount}
      />
    </View>
  );
}

const HERO_BODY_HEIGHT = 340;

function StateChipOnDark({ state }: { state: ShowState }): React.JSX.Element | null {
  if (state === 'past') return null;
  const config =
    state === 'ticketed'
      ? { label: 'TICKETED', icon: <Check size={10} color="#1a1a1a" strokeWidth={2.5} />, bg: '#fff', fg: '#1a1a1a' }
      : state === 'watching'
        ? { label: 'WATCHING', icon: <Eye size={10} color="#fff" strokeWidth={2.5} />, bg: 'rgba(0,0,0,0.42)', fg: '#fff' }
        : { label: 'WISHLIST', icon: <Bookmark size={10} color="#fff" strokeWidth={2.5} />, bg: 'rgba(0,0,0,0.42)', fg: '#fff' };
  return (
    <View
      style={[
        heroStyles.statePill,
        { backgroundColor: config.bg, borderColor: 'rgba(255,255,255,0.32)' },
      ]}
    >
      {config.icon}
      <Text style={[heroStyles.statePillText, { color: config.fg }]}>{config.label}</Text>
    </View>
  );
}

function HeaderStrip({
  show,
  onBack,
  onMore,
}: {
  show: ShowDetail;
  onBack?: () => void;
  onMore?: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const resolvedHeadliner = getHeadliner(show);
  const title = resolvedHeadliner === 'Unknown Artist' ? 'Untitled' : resolvedHeadliner;
  const date = show.date ? formatDateRangeShort(show.date, show.endDate) : null;
  const venueLine = [show.venue.name, show.venue.city]
    .filter((p) => !isVenuePlaceholder(p))
    .join(' · ');

  // Background photo. The venue image was chosen historically because
  // concerts/comedy already surface the headliner photo in the LINEUP
  // row below — repeating it here adds nothing. For production shows
  // (theatre + festival w/ productionName) the TM-sourced cover is the
  // show's identity, so it wins over the venue photo when populated. If
  // `coverImageUrl` hasn't been resolved yet the helper returns null and
  // we fall through to the venue photo, preserving the existing UX.
  // RemoteImage falls back to a kind-coloured monogram when neither is
  // available — same as before.
  const coverImage = hasProductionLabel(show)
    ? showCoverImageSource({ id: show.id, coverImageUrl: show.coverImageUrl }, token)
    : null;
  const venueImage = venueImageSource(show.venue, token);
  const backgroundImage = coverImage ?? venueImage;

  const eyebrow = date ? date.toUpperCase() : '';

  const heroHeight = insets.top + HERO_BODY_HEIGHT;

  return (
    <View
      testID="show-tabs-header"
      style={[heroStyles.hero, { height: heroHeight, borderBottomColor: colors.rule }]}
    >
      {/* Tappable photo background — opens the venue. The Pressable lives
          behind the chrome row (which is `pointerEvents: 'box-none'` so
          buttons receive their own taps). */}
      <Pressable
        testID="show-tabs-header-venue-image"
        onPress={() => router.push(`/venues/${show.venue.id}`)}
        accessibilityRole="link"
        accessibilityLabel={show.venue.name}
        style={StyleSheet.absoluteFill}
      >
        <RemoteImage
          uri={backgroundImage?.uri ?? null}
          headers={backgroundImage?.headers}
          name={coverImage ? title : show.venue.name}
          kind={show.kind as Kind}
          size="custom"
          height={heroHeight}
          style={StyleSheet.absoluteFill}
        />
      </Pressable>

      {/* Scrim: dark at top for status bar + floating chrome, transparent
          in the middle so the photo breathes, dark at bottom for the
          title block. */}
      <LinearGradient
        colors={[
          'rgba(0,0,0,0.55)',
          'rgba(0,0,0,0.20)',
          'rgba(0,0,0,0.00)',
          'rgba(0,0,0,0.30)',
          'rgba(0,0,0,0.82)',
        ]}
        locations={[0, 0.18, 0.42, 0.70, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Top row — floating chrome: back button + eyebrow pill on the
          left, state pill + more menu on the right, all on one line. */}
      <View
        style={[heroStyles.topRow, { paddingTop: insets.top + 8 }]}
        pointerEvents="box-none"
      >
        <View style={heroStyles.topLeftStack} pointerEvents="box-none">
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={8}
              style={({ pressed }) => [
                heroStyles.glassBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <ChevronLeft size={22} color="#fff" strokeWidth={2.2} />
            </Pressable>
          ) : (
            <View style={heroStyles.glassBtnPlaceholder} />
          )}
          {/* Eyebrow pill — frosted-glass so it stays legible against
              bright skies / busy photos. Sits inline with the back
              button so it lines up with the state pill on the right. */}
          <View style={heroStyles.eyebrowPill}>
            <Text style={heroStyles.eyebrow} numberOfLines={1}>
              {eyebrow}
            </Text>
          </View>
        </View>
        <View style={heroStyles.topRightStack} pointerEvents="box-none">
          {show.state !== 'past' ? (
            <StateChipOnDark state={show.state as ShowState} />
          ) : (
            <View
              testID="went-badge"
              style={[heroStyles.statePill, { backgroundColor: 'rgba(0,0,0,0.42)', borderColor: 'rgba(255,255,255,0.32)' }]}
            >
              <Text style={[heroStyles.statePillText, { color: '#fff' }]}>WENT</Text>
            </View>
          )}
          {onMore ? (
            <Pressable
              onPress={onMore}
              accessibilityRole="button"
              accessibilityLabel="More actions"
              hitSlop={8}
              style={({ pressed }) => [
                heroStyles.glassBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <MoreHorizontal size={20} color="#fff" strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Bottom block — kind chip, title, optional tour, venue link. */}
      <View style={heroStyles.bottomBlock} pointerEvents="box-none">
        <View style={heroStyles.kindRow}>
          <KindBadge kind={show.kind as Kind} size="sm" tone="onPhoto" />
        </View>
        <Text style={heroStyles.title} numberOfLines={2}>
          {title}
        </Text>
        {show.tourName ? (
          <Text style={heroStyles.tour} numberOfLines={1}>
            {show.tourName}
          </Text>
        ) : null}
        {venueLine ? (
          <Pressable
            onPress={() => router.push(`/venues/${show.venue.id}`)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${show.venue.name}`}
            hitSlop={6}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <Text style={heroStyles.venue} numberOfLines={1}>
              {venueLine}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
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
});

const heroStyles = StyleSheet.create({
  hero: {
    position: 'relative',
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#1a1525',
  },
  topRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  topLeftStack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  topRightStack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  glassBtn: {
    width: 36,
    height: 36,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassBtnPlaceholder: {
    width: 36,
    height: 36,
  },
  statePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statePillText: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10.5,
    letterSpacing: 10.5 * 0.08,
    textTransform: 'uppercase',
  },
  eyebrowPill: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADII.pill,
    flexShrink: 1,
  },
  eyebrow: {
    fontFamily: 'Geist Sans 600',
    fontSize: 11,
    letterSpacing: 11 * 0.14,
    textTransform: 'uppercase',
    color: '#1a1a1a',
  },
  bottomBlock: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 18,
    gap: 6,
  },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  title: {
    fontFamily: 'Fraunces',
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.8,
    lineHeight: 38,
    color: '#fff',
  },
  tour: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    color: 'rgba(255,255,255,0.86)',
  },
  venue: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    color: 'rgba(255,255,255,0.92)',
  },
});
