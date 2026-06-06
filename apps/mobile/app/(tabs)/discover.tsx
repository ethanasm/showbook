/**
 * Discover — bottom-nav tab.
 *
 * Mirrors the web Discover page (apps/web/app/(app)/discover/View.client.tsx):
 * a SegmentedControl across three feeds (Venues / Artists / Regions) plus a
 * horizontal chip rail with "All" + one chip per followed venue / artist /
 * region (the mobile-web parity that was missing pre-2026-05-19). Clicking a
 * chip filters the announcement list to that group; the active chip clears
 * on second tap.
 *
 * Data: each tab uses `useCachedQuery` against the same procedures the web
 * shell calls — `discover.followedFeed`, `discover.followedArtistsFeed`,
 * `discover.nearbyFeed` — plus the followed-list / preferences queries so
 * the chip row is seeded with freshly-followed entries (count 0) the same
 * way the web rail is. Pull-to-refresh re-syncs whichever tab is active.
 *
 * Discover feeds joined the offline warm-up scope on 2026-05-19 (see
 * `apps/mobile/CLAUDE.md` "Offline mode" + `lib/cache/warmup.ts`). The
 * screen-level offline gate stays as a safety net: when offline with truly
 * no cached rows (first-launch-before-online or a failed initial warmup) we
 * render `OfflineEmptyState`; otherwise cached rows from a prior online
 * session render so the user gets value when their connection drops.
 *
 * Empty-state note: this screen used to call `EmptyStateHero` (full-bleed
 * editorial card with GlowBackdrop + StackedCards + GradientEmphasis). That
 * stack repeatedly hit native-view registration issues on iOS (#263 dropped
 * SVG <Pattern>/<Mask>; the user still saw an "Unimplemented component:
 * <ViewManagerAdapter…>" red placeholder afterwards). Discover's empty
 * messages are informational, not editorial — the simple `EmptyState`
 * (plain View + Text + Pressable, no native plug-ins) is robust against the
 * same class of bugs and reads cleaner alongside the chip rail.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Linking,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  Calendar,
  ChevronRight,
  Filter,
  MapPin,
  Search,
  Users,
} from 'lucide-react-native';
import { useFeedback } from '@/lib/feedback';
import { formatDateParts, isNonWatchableKind } from '@showbook/shared';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { SegmentedControl } from '../../components/SegmentedControl';
import { EmptyState } from '../../components/EmptyState';
import { EmptyStateHero } from '../../components/design-system';
import { OfflineEmptyState } from '../../components/OfflineEmptyState';
import { KindBadge } from '../../components/KindBadge';
import { RemoteImage } from '../../components/design-system/RemoteImage';
import { TicketmasterMark } from '../../components/BrandIcons';
import { UpcomingAnnouncementActionSheet } from '../../components/UpcomingAnnouncementActionSheet';
import { FilterChipsRow, type FilterGroup } from '../../components/FilterChipsRow';
import { AddToDiscoverSheet } from '../../components/discover/AddToDiscoverSheet';
import { UnfollowChipSheet } from '../../components/discover/UnfollowChipSheet';
import { useTheme, type Kind } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { useAuth } from '@/lib/auth';
import { useNetwork } from '@/lib/network';
import { hapticSelection } from '@/lib/haptics';
import { useQueryClient } from '@tanstack/react-query';
import { trpc, type RouterOutput } from '@/lib/trpc';
import { useCachedQuery, getCacheOutbox, invalidateDiscoverFeeds } from '@/lib/cache';
import { runOptimisticMutation } from '@/lib/mutations';
import { useIngestPolling } from '@/lib/discover/useIngestPolling';
import {
  WATCHED_IDS_CACHE_KEY,
  useToggleWatch,
  type WatchToggle,
} from '@/lib/discover-watch';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { MeTopBarAction } from '../../components/MeTopBarAction';
import { PickPerformanceDateSheet } from '../../components/PickPerformanceDateSheet';
import { KindFilterMenu, type KindFilterValue } from '../../components/KindFilterMenu';

type UtilsClient = ReturnType<typeof trpc.useUtils>['client'];
type FollowedFeed = RouterOutput<UtilsClient['discover']['followedFeed']['query']>;
type NearbyFeed = RouterOutput<UtilsClient['discover']['nearbyFeed']['query']>;
type FollowedVenues = RouterOutput<UtilsClient['venues']['followed']['query']>;
type FollowedPerformers = RouterOutput<UtilsClient['performers']['followed']['query']>;
type PreferencesPayload = RouterOutput<UtilsClient['preferences']['get']['query']>;
type WatchedIds = RouterOutput<UtilsClient['discover']['watchedAnnouncementIds']['query']>;
type AnnouncementItem = FollowedFeed['items'][number];
type NearbyAnnouncementItem = NearbyFeed['items'][number];

type DiscoverTab = 'venues' | 'artists' | 'regions';

// Cap rendered rows per feed. The chip row and "N upcoming" summary still
// reflect the full filtered set; only the AnnouncementRow tree is sliced.
// With 800+ Region announcements rendered into a non-virtualized ScrollView
// the tab swap stalled for several seconds — paginating the render keeps
// the totals honest without paying that cost.
const PAGE_SIZE = 50;

/**
 * Multi-night runs (e.g. Phantom of the Opera at the Orpheum) carry a
 * `runStartDate` / `runEndDate` window and a full `performanceDates`
 * array. Single-night events have start === end. Mirrors the web
 * `isRun` predicate in `apps/web/app/(app)/discover/types.ts`.
 */
function isRun(item: AnnouncementItem | NearbyAnnouncementItem): boolean {
  return (
    !!item.runStartDate &&
    !!item.runEndDate &&
    item.runStartDate !== item.runEndDate
  );
}

/**
 * Compact run-end label for the narrow left date column. The start date
 * renders in the same stacked MONTH / DAY format a single-date row uses;
 * this line sits under the day to close the range — e.g. "– JUN 27".
 * The en-dash is load-bearing for the discover-runs web-test assertion.
 */
function formatRunEnd(end: string): string {
  const b = formatDateParts(end);
  return `– ${b.month} ${b.day}`;
}

function formatOnSale(value: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = formatDateParts(d);
  return `${parts.month} ${parts.day}`;
}

const ON_SALE_LABEL: Record<AnnouncementItem['onSaleStatus'], string> = {
  announced: 'Announced',
  presale: 'Presale',
  on_sale: 'On sale',
  sold_out: 'Sold out',
  cancelled: 'Cancelled',
};

/**
 * Group-key resolver, mirroring `apps/web/app/(app)/discover/grouping.ts`.
 * A single announcement may belong to multiple followed-artist groups (the
 * headliner plus any followed support acts); venue / region tabs have one
 * group key per item.
 */
function getGroupKeys(
  item: AnnouncementItem | NearbyAnnouncementItem,
  tab: DiscoverTab,
  followedArtistIds: Set<string> | null,
): string[] {
  if (tab === 'venues') {
    return item.venue.id ? [item.venue.id] : [];
  }
  if (tab === 'regions') {
    const nearby = item as NearbyAnnouncementItem;
    return nearby.regionId ? [nearby.regionId] : [];
  }
  // artists
  const ids = new Set<string>();
  if (item.headlinerPerformerId) ids.add(item.headlinerPerformerId);
  if (item.supportPerformerIds) {
    for (const id of item.supportPerformerIds) ids.add(id);
  }
  if (followedArtistIds) {
    return [...ids].filter((id) => followedArtistIds.has(id));
  }
  return [...ids];
}

export default function DiscoverScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { token } = useAuth();
  const network = useNetwork();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();
  const [tab, setTab] = React.useState<DiscoverTab>('venues');
  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);
  // Controls the inline add-typeahead sheet that mirrors web's
  // VenueSearchModal / FollowArtistSearch / RegionSearchModal. Stored
  // as the target tab (or null) so the sheet body can stay rendered
  // through the close animation against whichever tab opened it.
  const [addSheetTab, setAddSheetTab] = React.useState<DiscoverTab | null>(null);
  // Long-press target for the unfollow action sheet. Captures the tab the
  // chip belonged to so the sheet stays correct through its close
  // animation even if the user switches tabs underneath it.
  const [unfollowChip, setUnfollowChip] = React.useState<{
    tab: DiscoverTab;
    id: string;
    name: string;
  } | null>(null);
  // Secondary venue filter for the Regions tab — mirrors the web rail's
  // region → venue drill-down. Always reset when switching tabs or
  // regions so the chip row stays predictable.
  const [selectedRegionVenueId, setSelectedRegionVenueId] = React.useState<
    string | null
  >(null);

  // Kind filter — `all` shows everything the feed surfaces; the four
  // watchable kinds narrow the list. Driven by the dropdown opened from the
  // filter button next to search.
  const [kindFilter, setKindFilter] = React.useState<KindFilterValue>('all');
  const [kindMenuOpen, setKindMenuOpen] = React.useState(false);

  // Render budget for the current feed. Reset whenever the tab or any
  // chip filter changes so a freshly-selected scope always starts at
  // page 1 rather than carrying the previous tab's expanded budget.
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);

  // Clear filter when switching tabs — chips reset per-tab.
  React.useEffect(() => {
    setSelectedGroupId(null);
    setSelectedRegionVenueId(null);
  }, [tab]);

  React.useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [tab, selectedGroupId, selectedRegionVenueId, kindFilter]);

  // Clear the venue sub-filter whenever the user changes the region
  // selection above it; otherwise a stale venue id could leave the
  // result list empty after the user thought they had widened it.
  React.useEffect(() => {
    setSelectedRegionVenueId(null);
  }, [selectedGroupId]);

  // While a background ingest job is in flight (new region just added, a
  // venue/artist follow whose first sync hasn't finished), poll
  // `discover.ingestStatus` and refetch the affected feed every few
  // seconds so the count grows as rows land in the DB. Without this the
  // user sees "8 venues" on cold launch and has to pull-to-refresh to
  // discover the real "800 venues" number. Mirrors the web
  // `IngestStatusPoller`.
  const ingestPolling = useIngestPolling({
    enabled: Boolean(token) && network.online,
  });

  // Limits match the web Discover queries (apps/web/app/(app)/discover):
  // followedFeed / followedArtistsFeed page at 100, nearbyFeed takes the
  // server default. Mobile previously capped these much tighter (50 / 50 / 25)
  // which made Regions in particular look thin against the web equivalent.
  //
  // `refetchOnMount: 'always'` is load-bearing: the offline warm-up
  // (`lib/cache/warmup.ts`) pre-seeds these exact query keys with a
  // deliberately tiny snapshot (followedFeed `limit: 12`, nearbyFeed
  // `perRegionLimit: 8`) so a cold offline open renders something. That
  // `setQueryData` write is marked fresh, so without forcing a mount
  // refetch the default 30s `staleTime` would leave the screen pinned to
  // the warm-up placeholder — "8 venues" until the user pulled to refresh.
  // Forcing the refetch loads the full `limit: 100` / `perRegionLimit:
  // 2500` set automatically (the warm-up rows render instantly as a
  // placeholder while the background fetch runs).
  const followedVenuesQuery = useCachedQuery<FollowedFeed>({
    queryKey: ['mobile', 'discover', 'followedFeed'],
    queryFn: () => utils.client.discover.followedFeed.query({ limit: 100 }),
    enabled: Boolean(token),
    refetchOnMount: 'always',
    refetchInterval: ingestPolling.intervals.venues,
  });

  const followedArtistsQuery = useCachedQuery<FollowedFeed>({
    queryKey: ['mobile', 'discover', 'followedArtistsFeed'],
    queryFn: () => utils.client.discover.followedArtistsFeed.query({ limit: 100 }),
    enabled: Boolean(token),
    refetchOnMount: 'always',
    refetchInterval: ingestPolling.intervals.artists,
  });

  const nearbyQuery = useCachedQuery<NearbyFeed>({
    queryKey: ['mobile', 'discover', 'nearbyFeed'],
    queryFn: () => utils.client.discover.nearbyFeed.query({}),
    enabled: Boolean(token),
    refetchOnMount: 'always',
    refetchInterval: ingestPolling.intervals.nearby,
  });

  // Followed-list queries seed chips with count=0 so a freshly-followed
  // venue / artist / region shows up before its first ingest lands.
  const followedVenuesList = useCachedQuery<FollowedVenues>({
    queryKey: ['mobile', 'venues', 'followed'],
    queryFn: () => utils.client.venues.followed.query(),
    enabled: Boolean(token),
  });

  const followedArtistsList = useCachedQuery<FollowedPerformers>({
    queryKey: ['mobile', 'artists', 'followed'],
    queryFn: () => utils.client.performers.followed.query(),
    enabled: Boolean(token),
  });

  const preferencesQuery = useCachedQuery<PreferencesPayload>({
    queryKey: ['mobile', 'preferences', 'get'],
    queryFn: () => utils.client.preferences.get.query(),
    enabled: Boolean(token),
  });

  // Watched-event set drives the per-row "Watching" indicator. Cached so a
  // cold offline open renders the correct state instead of flashing every
  // row back to "Follow" until the network round-trip lands.
  const watchedQuery = useCachedQuery<WatchedIds>({
    queryKey: WATCHED_IDS_CACHE_KEY,
    queryFn: () => utils.client.discover.watchedAnnouncementIds.query(),
    enabled: Boolean(token),
  });
  const watchedSet = React.useMemo(
    () => new Set(watchedQuery.data ?? []),
    [watchedQuery.data],
  );

  const onToggleWatch = useToggleWatch();

  const activeQuery =
    tab === 'venues'
      ? followedVenuesQuery
      : tab === 'artists'
        ? followedArtistsQuery
        : nearbyQuery;

  // Auto-refresh on focus. Tab screens mount once and stay mounted, so
  // `refetchOnMount: 'always'` only fires on the very first visit — and even
  // that first fetch raced the offline warm-up, which could clobber the full
  // feed back down to its tiny snapshot (now blocked by `seedDiscoverFeed` in
  // warmup.ts). Refetching the active feed every time the tab regains focus
  // guarantees the full set loads in over the warm-up placeholder without a
  // manual pull-to-refresh — the behaviour the user expects and the same
  // pattern the Map tab uses. A "latest ref" (updated in a commit effect, not
  // during render) keeps the focus callback stable on `[token]` so it fires
  // on focus / sign-in rather than on every query-identity change.
  const activeQueryRef = React.useRef(activeQuery);
  React.useEffect(() => {
    activeQueryRef.current = activeQuery;
  });
  useFocusEffect(
    React.useCallback(() => {
      if (!token) return;
      void activeQueryRef.current.refetch();
    }, [token]),
  );

  // True while the active feed is refetching in the background with rows
  // already on screen — the warm-up-placeholder → full-feed focus refetch,
  // a pull-to-refresh, or a feed re-fetch the ingest poll triggered. Drives
  // the inline "updating…" status so the count isn't silently stale while
  // the full set loads in over the small warm-up snapshot.
  const isBackgroundRefetching =
    activeQuery.isFetching && !activeQuery.isLoading;

  const refreshControl = useThemedRefreshControl(
    isBackgroundRefetching,
    () => {
      void activeQuery.refetch();
    },
  );

  const searchAction = (
    <View style={styles.actions}>
      <Pressable
        onPress={() => setKindMenuOpen(true)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Filter by kind"
        accessibilityState={{ expanded: kindMenuOpen }}
        testID="discover-filter-button"
      >
        <Filter
          size={20}
          color={kindFilter === 'all' ? colors.ink : colors.accent}
          strokeWidth={2}
          fill={kindFilter === 'all' ? 'transparent' : colors.accent}
        />
      </Pressable>
      <Pressable
        onPress={() => router.push('/search')}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Search"
        testID="discover-search-button"
      >
        <Search size={20} color={colors.ink} strokeWidth={2} />
      </Pressable>
      <MeTopBarAction />
    </View>
  );

  const items = React.useMemo(
    () => activeQuery.data?.items ?? [],
    [activeQuery.data?.items],
  );
  const nearbyHasRegions =
    tab === 'regions'
      ? (nearbyQuery.data as NearbyFeed | undefined)?.hasRegions ?? null
      : null;

  const followedArtistIdSet = React.useMemo(() => {
    if (!followedArtistsList.data) return null;
    return new Set(followedArtistsList.data.map((a) => a.id));
  }, [followedArtistsList.data]);

  // Build the chip list. Seed from the followed-list so unannounced entries
  // still get a chip with count=0, then add any announcement-only groups
  // (e.g. a Spotify-imported artist whose follow row hasn't synced yet).
  const groupList = React.useMemo<FilterGroup[]>(() => {
    const seen = new Map<string, FilterGroup>();

    if (tab === 'venues' && followedVenuesList.data) {
      for (const v of followedVenuesList.data) {
        seen.set(v.id, { id: v.id, name: v.name, sublabel: v.city, count: 0 });
      }
    }
    if (tab === 'artists' && followedArtistsList.data) {
      for (const a of followedArtistsList.data) {
        seen.set(a.id, { id: a.id, name: a.name, count: 0 });
      }
    }
    if (tab === 'regions') {
      const regions = preferencesQuery.data?.regions ?? [];
      for (const r of regions) {
        if (r.active === false) continue;
        seen.set(r.id, {
          id: r.id,
          name: r.cityName,
          sublabel: `${r.radiusMiles}mi`,
          count: 0,
        });
      }
    }

    for (const item of items) {
      const keys = getGroupKeys(item, tab, followedArtistIdSet);
      for (const key of keys) {
        if (!seen.has(key)) {
          const fallbackName =
            tab === 'artists'
              ? item.headliner
              : tab === 'regions'
                ? (item as NearbyAnnouncementItem).regionCityName ?? 'Region'
                : item.venue.name;
          const fallbackSub =
            tab === 'venues'
              ? item.venue.city
              : tab === 'regions'
                ? `${(item as NearbyAnnouncementItem).regionRadiusMiles ?? '?'}mi`
                : undefined;
          seen.set(key, {
            id: key,
            name: fallbackName,
            sublabel: fallbackSub ?? undefined,
            count: 0,
          });
        }
        seen.get(key)!.count++;
      }
    }

    return Array.from(seen.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  }, [
    items,
    tab,
    followedVenuesList.data,
    followedArtistsList.data,
    preferencesQuery.data,
    followedArtistIdSet,
  ]);

  // Region-scoped venue chip list. Only meaningful on the Regions tab —
  // when a region is selected we scope to that region's venues; with no
  // region selected the chip row reflects every venue surfaced in the
  // nearby feed so the user can still drill down without picking a
  // region first. Mirrors the web `VenueRail` rail-under-region
  // behaviour.
  const regionVenueList = React.useMemo<FilterGroup[]>(() => {
    if (tab !== 'regions') return [];
    const nearbyItems = items as NearbyAnnouncementItem[];
    const inScope = selectedGroupId
      ? nearbyItems.filter((item) => item.regionId === selectedGroupId)
      : nearbyItems;
    const byVenue = new Map<string, FilterGroup>();
    for (const item of inScope) {
      const id = item.venue.id;
      if (!id) continue;
      const existing = byVenue.get(id);
      if (existing) {
        existing.count++;
      } else {
        // Region-scoped venue chips: omit the city sublabel — it's redundant
        // under a region chip that already names the city, and the
        // "Cobb's Comedy Club · San Francis…" truncation looked worse than
        // the bare venue name does.
        byVenue.set(id, {
          id,
          name: item.venue.name,
          count: 1,
        });
      }
    }
    return Array.from(byVenue.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  }, [items, selectedGroupId, tab]);

  const filteredItems = React.useMemo(() => {
    let result = items;
    if (selectedGroupId) {
      result = result.filter((item) =>
        getGroupKeys(item, tab, followedArtistIdSet).includes(selectedGroupId),
      );
    }
    if (tab === 'regions' && selectedRegionVenueId) {
      result = result.filter(
        (item) => item.venue.id === selectedRegionVenueId,
      );
    }
    if (kindFilter !== 'all') {
      result = result.filter((item) => item.kind === kindFilter);
    }
    return result;
  }, [
    items,
    selectedGroupId,
    selectedRegionVenueId,
    tab,
    followedArtistIdSet,
    kindFilter,
  ]);

  // Does the user follow anything on this tab yet? Seeds the decision to
  // keep the onboarding hero vs. drop into the chip-rail + "discovering
  // more shows…" state. A freshly-followed entity (venue/artist/region)
  // has a chip with count 0 before its first ingest lands, so we want the
  // rail + status row rather than the first-run hero in that window.
  const hasFollowedEntities =
    tab === 'venues'
      ? (followedVenuesList.data?.length ?? 0) > 0
      : tab === 'artists'
        ? (followedArtistsList.data?.length ?? 0) > 0
        : (preferencesQuery.data?.regions?.filter((r) => r.active !== false)
            .length ?? 0) > 0;

  const showOfflineEmpty = !network.online && !activeQuery.data;
  const isLoading = activeQuery.isLoading;
  const isErrored = !isLoading && activeQuery.isError && !activeQuery.data;
  // Reserve the full-bleed onboarding hero for true first-run: no
  // announcements AND nothing followed on this tab AND no ingest job
  // actually pending. Once the user follows something (chip seeded) or
  // an ingest is reported in flight, we render the chip rail + summary so
  // the just-added entity and the "discovering more shows…" status are
  // visible immediately. We key off `isAnyPending` (a reported pending
  // job) rather than `isPolling` (which is also true during the initial
  // ingestStatus round-trip) so the hero doesn't flicker on cold open.
  const isEmpty =
    !isLoading &&
    !isErrored &&
    items.length === 0 &&
    !hasFollowedEntities &&
    !ingestPolling.isAnyPending;
  const filterCount = filteredItems.length;

  const visibleItems = React.useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount],
  );
  const remainingCount = Math.max(0, filterCount - visibleItems.length);
  const hasMore = remainingCount > 0;

  // Long-press a chip → open the unfollow sheet for that group. The "All"
  // chip and the leading "+" action don't get this affordance (handled in
  // FilterChipsRow, which only wires onLongPress to per-group chips).
  const handleChipLongPress = (id: string): void => {
    const group = groupList.find((g) => g.id === id);
    void hapticSelection();
    setUnfollowChip({ tab, id, name: group?.name ?? '' });
  };

  // Unfollow / remove a single Discover entity, scoped to the tab it
  // belongs to. Shared by the long-press confirm sheet and the overflow
  // picker's trash affordance (which removes directly, no confirm sheet).
  const performUnfollow = async (
    target: DiscoverTab,
    id: string,
    name: string,
  ): Promise<void> => {
    // Drop the filter if it pointed at the chip we're removing so the feed
    // doesn't get stuck filtered to a now-gone group.
    setSelectedGroupId((prev) => (prev === id ? null : prev));
    if (target === 'regions') {
      setSelectedRegionVenueId(null);
    }
    try {
      if (target === 'venues') {
        const key = ['mobile', 'venues', 'followed'];
        const feedKey = ['mobile', 'discover', 'followedFeed'];
        await runOptimisticMutation({
          mutation: 'venues.unfollow',
          input: { venueId: id },
          outbox: getCacheOutbox(),
          call: (input) => utils.client.venues.unfollow.mutate(input),
          optimistic: {
            // Snapshot + prune the feed alongside the followed list: the
            // chip rail re-seeds groups from the cached feed items, so
            // dropping the follow row alone leaves the chip (and its rows)
            // lingering until the background refetch. Each announcement
            // belongs to exactly one venue, so pruning by venue id is
            // unambiguous — the chip and its rows vanish on confirm.
            snapshot: () => ({
              list: queryClient.getQueryData<{ id: string }[]>(key),
              feed: queryClient.getQueryData<FollowedFeed>(feedKey),
            }),
            apply: () => {
              queryClient.setQueryData<{ id: string }[]>(key, (prev) =>
                (prev ?? []).filter((v) => v.id !== id),
              );
              queryClient.setQueryData<FollowedFeed>(feedKey, (prev) =>
                prev
                  ? { ...prev, items: prev.items.filter((it) => it.venue.id !== id) }
                  : prev,
              );
            },
            rollback: (snap) => {
              queryClient.setQueryData(key, snap.list);
              queryClient.setQueryData(feedKey, snap.feed);
            },
          },
          reconcile: () => {
            invalidateDiscoverFeeds(queryClient);
            void utils.venues.list.invalidate();
          },
        });
      } else if (target === 'artists') {
        const key = ['mobile', 'artists', 'followed'];
        await runOptimisticMutation({
          mutation: 'performers.unfollow',
          input: { performerId: id },
          outbox: getCacheOutbox(),
          call: (input) => utils.client.performers.unfollow.mutate(input),
          optimistic: {
            // Feed left untouched on purpose: the artist chip already
            // vanishes immediately (the rail filters artist chips through
            // the followed-set we prune here), and an announcement can
            // still belong to the followed-artists feed via a headliner
            // you follow when only a support act was unfollowed — pruning
            // by performer id would wrongly drop those. The refetch in
            // reconcile clears any genuinely orphaned rows.
            snapshot: () => queryClient.getQueryData<{ id: string }[]>(key),
            apply: () => {
              queryClient.setQueryData<{ id: string }[]>(key, (prev) =>
                (prev ?? []).filter((a) => a.id !== id),
              );
            },
            rollback: (snap) => queryClient.setQueryData(key, snap),
          },
          reconcile: () => {
            invalidateDiscoverFeeds(queryClient);
            void utils.performers.list.invalidate();
          },
        });
      } else {
        const key = ['mobile', 'preferences', 'get'];
        const feedKey = ['mobile', 'discover', 'nearbyFeed'];
        await runOptimisticMutation({
          mutation: 'preferences.removeRegion',
          input: { regionId: id },
          outbox: getCacheOutbox(),
          call: (input) => utils.client.preferences.removeRegion.mutate(input),
          optimistic: {
            // As with venues: prune the nearby feed too so the region
            // chip and its grouped rows clear on confirm rather than
            // lingering until the refetch. Each nearby announcement
            // carries a single owning regionId, so the prune is exact.
            snapshot: () => ({
              prefs: queryClient.getQueryData<PreferencesPayload>(key),
              feed: queryClient.getQueryData<NearbyFeed>(feedKey),
            }),
            apply: () => {
              queryClient.setQueryData<PreferencesPayload>(key, (prev) =>
                prev
                  ? {
                      ...prev,
                      regions: (prev.regions ?? []).filter((r) => r.id !== id),
                    }
                  : prev,
              );
              queryClient.setQueryData<NearbyFeed>(feedKey, (prev) =>
                prev
                  ? { ...prev, items: prev.items.filter((it) => it.regionId !== id) }
                  : prev,
              );
            },
            rollback: (snap) => {
              queryClient.setQueryData(key, snap.prefs);
              queryClient.setQueryData(feedKey, snap.feed);
            },
          },
          reconcile: () => invalidateDiscoverFeeds(queryClient),
        });
      }
      showToast({
        kind: 'success',
        text:
          target === 'regions'
            ? `Removed ${name}`
            : `Unfollowed ${name}`,
      });
    } catch {
      // The outbox owns the queued unfollow; the offline-sync provider
      // replays it. Keep the user informed without alarming them.
      showToast({
        kind: 'info',
        text: "We'll update Discover when you're back online.",
      });
    }
  };

  return (
    <>
    <ScreenWrapper
      title="Discover"
      eyebrow="WHAT'S COMING UP"
      rightAction={searchAction}
      large
    >
      <View style={styles.segmentWrap}>
        <SegmentedControl<DiscoverTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'venues', label: 'Venues' },
            { value: 'artists', label: 'Artists' },
            { value: 'regions', label: 'Regions' },
          ]}
        />
      </View>

      {!showOfflineEmpty && !isLoading && !isEmpty && groupList.length > 0 && (
        <FilterChipsRow
          groups={groupList}
          selected={selectedGroupId}
          onSelect={setSelectedGroupId}
          onLongPress={handleChipLongPress}
          onRemove={(id) => {
            const group = groupList.find((g) => g.id === id);
            void performUnfollow(tab, id, group?.name ?? '');
          }}
          totalCount={items.length}
          testIdPrefix="discover-group"
          pickerTitle={groupPickerTitle(tab)}
          leadingAction={{
            label: addChipLabel(tab),
            onPress: () => setAddSheetTab(tab),
            testID: `discover-add-chip-${tab}`,
            accessibilityLabel: addChipAccessibilityLabel(tab),
          }}
        />
      )}

      {/* Regions tab gets a second-tier venue chip row under the region
          row so the user can drill region → venue without leaving the
          tab. Matches web's `VenueRail` rail-under-region behaviour;
          the "All venues" chip clears the venue sub-filter. Suppressed
          when fewer than two venues exist (a single-venue chip row
          adds clutter for no filter value). */}
      {!showOfflineEmpty &&
        !isLoading &&
        !isEmpty &&
        tab === 'regions' &&
        regionVenueList.length > 1 && (
          <FilterChipsRow
            groups={regionVenueList}
            selected={selectedRegionVenueId}
            onSelect={setSelectedRegionVenueId}
            totalCount={regionVenueList.reduce((n, g) => n + g.count, 0)}
            allLabel="All venues"
            variant="sub"
            testIdPrefix="discover-venue-chip"
          />
        )}

      <ScrollView
        contentContainerStyle={
          isLoading || isEmpty || showOfflineEmpty
            ? styles.scrollFlex
            : styles.scrollContent
        }
        refreshControl={refreshControl}
      >
        {showOfflineEmpty ? (
          <OfflineEmptyState
            title="Discover needs a connection"
            subtitle="Followed feeds and nearby announcements update only when you're online."
          />
        ) : isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : isErrored ? (
          <View style={styles.center}>
            <EmptyState
              title="Couldn't load Discover"
              subtitle={
                activeQuery.error instanceof Error
                  ? activeQuery.error.message
                  : 'Tap to try again.'
              }
              cta={{
                label: 'Try again',
                onPress: () => void activeQuery.refetch(),
              }}
            />
          </View>
        ) : isEmpty ? (
          <EmptyForTab
            tab={tab}
            hasRegions={nearbyHasRegions}
            onOpenAdd={(t) => setAddSheetTab(t)}
          />
        ) : (
          <>
            <View style={styles.summaryRow}>
              <SummaryIcon tab={tab} color={colors.muted} />
              <Text style={[styles.summaryText, { color: colors.muted }]}>
                {filterCount} upcoming ·{' '}
                {ingestPolling.isPolling
                  ? 'discovering more shows…'
                  : isBackgroundRefetching
                    ? 'updating…'
                    : 'pull to refresh'}
              </Text>
              {(ingestPolling.isPolling || isBackgroundRefetching) && (
                <ActivityIndicator
                  size="small"
                  color={colors.muted}
                  style={styles.summarySpinner}
                  testID="discover-ingest-spinner"
                  accessibilityLabel={
                    ingestPolling.isPolling
                      ? 'Discovering more shows'
                      : 'Updating'
                  }
                />
              )}
            </View>
            {filterCount === 0 ? (
              <View style={styles.inlineEmpty}>
                <Text style={[styles.inlineEmptyText, { color: colors.muted }]}>
                  {ingestPolling.isPolling
                    ? 'Hang tight — pulling in shows for what you just followed.'
                    : 'No upcoming announcements yet. New ones land here automatically.'}
                </Text>
              </View>
            ) : tab === 'regions' && !selectedGroupId ? (
              <RegionGroupedList
                items={visibleItems as NearbyAnnouncementItem[]}
                groups={groupList}
                watchedSet={watchedSet}
                onToggleWatch={onToggleWatch}
              />
            ) : (
              <View style={styles.list}>
                {visibleItems.map((item) => (
                  <AnnouncementRow
                    key={item.id}
                    item={item}
                    isWatching={watchedSet.has(item.id)}
                    onToggleWatch={onToggleWatch}
                  />
                ))}
              </View>
            )}
            {hasMore && (
              <LoadMoreButton
                remaining={remainingCount}
                pageSize={PAGE_SIZE}
                onPress={() => {
                  hapticSelection();
                  setVisibleCount((c) => c + PAGE_SIZE);
                }}
              />
            )}
          </>
        )}
      </ScrollView>
    </ScreenWrapper>
    <KindFilterMenu
      open={kindMenuOpen}
      value={kindFilter}
      onSelect={setKindFilter}
      onClose={() => setKindMenuOpen(false)}
    />
    <AddToDiscoverSheet
      tab={addSheetTab ?? tab}
      open={addSheetTab !== null}
      onClose={() => setAddSheetTab(null)}
    />
    <UnfollowChipSheet
      open={unfollowChip !== null}
      onClose={() => setUnfollowChip(null)}
      tab={unfollowChip?.tab ?? tab}
      name={unfollowChip?.name ?? null}
      onConfirm={() => {
        if (unfollowChip) {
          void performUnfollow(unfollowChip.tab, unfollowChip.id, unfollowChip.name);
        }
      }}
    />
    </>
  );
}

function LoadMoreButton({
  remaining,
  pageSize,
  onPress,
}: {
  remaining: number;
  pageSize: number;
  onPress: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const next = Math.min(pageSize, remaining);
  return (
    <View style={styles.loadMoreWrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Load ${next} more`}
        testID="discover-load-more"
        style={({ pressed }) => [
          styles.loadMoreButton,
          { borderColor: colors.rule, backgroundColor: colors.surface },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={[styles.loadMoreLabel, { color: colors.ink }]}>
          Load {next} more
        </Text>
        <Text style={[styles.loadMoreMeta, { color: colors.muted }]}>
          {remaining} remaining
        </Text>
      </Pressable>
    </View>
  );
}

function RegionGroupedList({
  items,
  groups,
  watchedSet,
  onToggleWatch,
}: {
  items: NearbyAnnouncementItem[];
  groups: FilterGroup[];
  watchedSet: Set<string>;
  onToggleWatch: WatchToggle;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  // Bucket items by region id; preserve the group order from the chip list
  // (which is count-desc) so the densest region floats to the top.
  const buckets = React.useMemo(() => {
    const map = new Map<string, NearbyAnnouncementItem[]>();
    for (const item of items) {
      const key = item.regionId ?? '__unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  const orderedGroups = groups.filter((g) => buckets.has(g.id));

  return (
    <View style={styles.list}>
      {orderedGroups.map((g) => {
        const groupItems = buckets.get(g.id) ?? [];
        return (
          <View key={g.id} style={styles.regionGroup}>
            <View style={styles.regionHeader}>
              <Text style={[styles.regionHeaderName, { color: colors.ink }]}>
                {g.name}
              </Text>
              <Text style={[styles.regionHeaderMeta, { color: colors.muted }]}>
                {g.sublabel ? `${g.sublabel} · ` : ''}
                {groupItems.length} upcoming
              </Text>
            </View>
            {groupItems.map((item) => (
              <AnnouncementRow
                key={item.id}
                item={item}
                isWatching={watchedSet.has(item.id)}
                onToggleWatch={onToggleWatch}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function SummaryIcon({
  tab,
  color,
}: {
  tab: DiscoverTab;
  color: string;
}): React.JSX.Element {
  if (tab === 'venues') return <MapPin size={13} color={color} strokeWidth={2} />;
  if (tab === 'artists') return <Users size={13} color={color} strokeWidth={2} />;
  return <Calendar size={13} color={color} strokeWidth={2} />;
}

/**
 * Editorial empty state for the Discover tabs — mirrors the hero that
 * Home / Shows / Venues / Artists already use. EmptyStateHero is safe
 * to mount under iOS now that its title no longer hosts a `MaskedView`
 * inside a parent `<Text>` (see `EmptyStateHero.tsx` docblock).
 *
 * Falls back to the compact `EmptyState` for the "Quiet week" copy —
 * that one fires when the user already has regions configured but the
 * nearby feed is empty, so the editorial-onboarding visual would be
 * out of place (no setup action to drive towards).
 */
function EmptyForTab({
  tab,
  hasRegions,
  onOpenAdd,
}: {
  tab: DiscoverTab;
  hasRegions: boolean | null;
  onOpenAdd: (tab: DiscoverTab) => void;
}): React.JSX.Element {
  if (tab === 'venues') {
    return (
      <View style={styles.emptyHeroWrap}>
        <EmptyStateHero
          kind="venues"
          title="Follow a venue"
          body="Search a hall, theatre, or dive bar and follow it — upcoming announcements land here as soon as they go on sale."
          action={{ label: 'Search venues', onPress: () => onOpenAdd('venues') }}
        />
      </View>
    );
  }
  if (tab === 'artists') {
    return (
      <View style={styles.emptyHeroWrap}>
        <EmptyStateHero
          kind="artists"
          title="Follow an artist"
          body="Search for an artist and follow them to see their tour announcements the moment they go on sale."
          action={{ label: 'Search artists', onPress: () => onOpenAdd('artists') }}
        />
      </View>
    );
  }
  if (hasRegions === false) {
    return (
      <View style={styles.emptyHeroWrap}>
        <EmptyStateHero
          kind="discover"
          title="Add a region"
          body="Pick a city + radius to surface nearby announcements and power your daily email digest. Up to five fit; start with the city you live in."
          action={{ label: 'Pick a city', onPress: () => onOpenAdd('regions') }}
        />
      </View>
    );
  }
  return (
    <EmptyState
      title="Quiet week"
      subtitle="No new announcements in your saved regions yet. Check back after the next ingest."
    />
  );
}

function addChipLabel(tab: DiscoverTab): string {
  if (tab === 'venues') return 'Follow venue';
  if (tab === 'artists') return 'Follow artist';
  return 'Add region';
}

function groupPickerTitle(tab: DiscoverTab): string {
  if (tab === 'venues') return 'All venues';
  if (tab === 'artists') return 'All artists';
  return 'All regions';
}

function addChipAccessibilityLabel(tab: DiscoverTab): string {
  if (tab === 'venues') return 'Follow a venue';
  if (tab === 'artists') return 'Follow an artist';
  return 'Add a region';
}

/**
 * Renders -45° diagonal stripes scaled to the parent card's measured
 * dimensions. Used as a background layer on sold-out and cancelled
 * announcements so the row is recognisably struck through without obscuring
 * the text. The comment in this file's header (iOS #263) explains why SVG
 * Pattern/Mask is off the table — we draw explicit <Line> elements instead.
 *
 * The stripes are deliberately pronounced: tighter spacing, thicker strokes
 * and higher opacity than a hairline so the struck-through treatment reads at
 * a glance.
 */
function SoldOutStripes({
  color,
  width,
  height,
}: {
  color: string;
  width: number;
  height: number;
}): React.JSX.Element | null {
  if (width <= 0 || height <= 0) return null;
  const spacing = 6;
  const lines: React.ReactElement[] = [];
  for (let x = -height; x < width; x += spacing) {
    lines.push(
      <Line
        key={x}
        x1={x}
        y1={0}
        x2={x + height}
        y2={height}
        stroke={color}
        strokeWidth={1.5}
        opacity={0.7}
      />,
    );
  }
  return (
    <Svg
      width={width}
      height={height}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    >
      {lines}
    </Svg>
  );
}

// Memoized: the feed renders up to PAGE_SIZE (50) of these, and the
// Discover screen re-renders on every ingest-poll tick / watched-set
// update / refetch `isFetching` toggle. Without memo all 50 rows
// reconciled on each of those — the bulk of the scroll/tab lag. Props
// are stable (`item` from the query cache, `onToggleWatch` a stable
// `useCallback`); only the toggled row's `isWatching` changes.
const AnnouncementRow = React.memo(function AnnouncementRow({
  item,
  isWatching,
  onToggleWatch,
}: {
  item: AnnouncementItem;
  isWatching: boolean;
  onToggleWatch: WatchToggle;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { showToast } = useFeedback();
  const { month, day, year, dow } = formatDateParts(item.showDate);
  const accent = tokens.kindColor(item.kind as Kind);
  const onSale = formatOnSale(item.onSaleDate);
  const onSaleLabel = ON_SALE_LABEL[item.onSaleStatus];
  const ticketUrl = item.ticketUrl;
  const isSoldOut = item.onSaleStatus === 'sold_out';
  const isCancelled = item.onSaleStatus === 'cancelled';
  // Both sold-out and cancelled rows get the struck-through stripe treatment.
  const isStruck = isSoldOut || isCancelled;
  const runMode = isRun(item);
  const runEndLabel =
    runMode && item.runEndDate ? formatRunEnd(item.runEndDate) : null;
  // Festivals are a single experience over a date range; multi-night
  // theatre / comedy / concert runs are N separate performances and
  // need a date pick. Mirrors `discover.watchlist`'s `isDatePickingRun`
  // server-side check.
  const isDatePickingRun = runMode && item.kind !== 'festival';
  const performanceDates = item.performanceDates ?? [];
  const performanceCount = performanceDates.length;
  const [pickDateOpen, setPickDateOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [cardSize, setCardSize] = React.useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  const onCardLayout = React.useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setCardSize((prev) =>
      prev.w === width && prev.h === height ? prev : { w: width, h: height },
    );
  }, []);
  const title = item.productionName ?? item.headliner;

  const navigateToAddForm = React.useCallback(
    (dateHint: string): void => {
      router.push({
        pathname: '/add/form',
        params: {
          kindHint: item.kind,
          headliner: item.productionName ?? item.headliner,
          venueHint: item.venue.name,
          dateHint,
        },
      });
    },
    [router, item.kind, item.productionName, item.headliner, item.venue.name],
  );
  const venueLabel = [item.venue.name, item.venue.city].filter(Boolean).join(' · ');
  const support =
    item.support && item.support.length > 0
      ? `+ ${item.support.join(', ')}`
      : null;
  // Theatre productions use the productionName as the title and don't
  // carry a meaningful headlinerPerformerId for navigation — match the
  // web row which only links when a real performer id is present.
  const headlinerLinkId =
    !item.productionName && item.headlinerPerformerId
      ? item.headlinerPerformerId
      : null;

  const canWatch = !isNonWatchableKind(item.kind);

  const onPress = () => {
    void hapticSelection();
    setSheetOpen(true);
  };

  return (
    <>
    <Pressable
      onPress={onPress}
      onLayout={isStruck ? onCardLayout : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${title} — open actions`}
      testID={`discover-row-${item.id}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface },
        isStruck && styles.cardSoldOut,
        pressed && { opacity: 0.9 },
      ]}
    >
      {isStruck && (
        <SoldOutStripes
          color={isCancelled ? colors.danger : colors.ruleStrong}
          width={cardSize.w}
          height={cardSize.h}
        />
      )}

      {/* Left edge bar — kind-coloured, mirrors the Shows-tab ShowCard so
          discover rows read as the same row family. */}
      <View style={[styles.stateBar, { backgroundColor: accent }]} />

      {/* Date column — single-date rows stack MONTH / DAY / DOW / YEAR;
          multi-night runs reuse the same narrow column, closing the range
          with a compact "– END" line and an "N dates" count. */}
      {runMode && runEndLabel ? (
        <View style={styles.dateBlock} testID={`discover-row-run-${item.id}`}>
          <Text style={[styles.dateMonth, { color: colors.muted }]}>{month}</Text>
          <Text style={[styles.dateDay, { color: colors.ink }]}>{day}</Text>
          <Text style={[styles.dateRunEnd, { color: colors.ink }]}>
            {runEndLabel}
          </Text>
          <Text style={[styles.dateDow, { color: colors.faint }]}>
            {performanceCount > 0 ? `${performanceCount} dates` : year}
          </Text>
        </View>
      ) : (
        <View style={styles.dateBlock}>
          <Text style={[styles.dateMonth, { color: colors.muted }]}>{month}</Text>
          <Text style={[styles.dateDay, { color: colors.ink }]}>{day}</Text>
          {dow ? (
            <Text style={[styles.dateDow, { color: colors.faint }]}>{dow}</Text>
          ) : null}
          <Text style={[styles.dateYear, { color: colors.faint }]}>{year}</Text>
        </View>
      )}

      {/* Headliner artwork — joined from the performer record. Falls back
          to the kind-coloured monogram when the announcement has no matched
          performer (most theatre / festival productions). */}
      <RemoteImage
        uri={item.headlinerImageUrl ?? null}
        name={title}
        kind={item.kind as Kind}
        size="thumb"
        style={styles.avatar}
      />

      {/* Content column */}
      <View style={styles.content}>
        <View style={styles.badgeRow}>
          <KindBadge kind={item.kind as Kind} size="sm" />
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor:
                  (isCancelled ? colors.danger : accent) + '22',
              },
            ]}
          >
            <Text
              style={[
                styles.statusLabel,
                { color: isCancelled ? colors.danger : accent },
              ]}
            >
              {onSaleLabel}
            </Text>
          </View>
        </View>

        {headlinerLinkId ? (
          <Text
            onPress={() => router.push(`/artists/${headlinerLinkId}`)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${title}`}
            style={[styles.cardTitle, { color: colors.ink }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {title}
          </Text>
        ) : (
          <Text
            style={[styles.cardTitle, { color: colors.ink }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {title}
          </Text>
        )}

        {support && (
          <Text
            style={[styles.cardSupport, { color: colors.muted }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {support}
          </Text>
        )}

        {item.venue.id ? (
          <Text
            onPress={() => router.push(`/venues/${item.venue.id}`)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${item.venue.name}`}
            style={[styles.cardVenue, { color: colors.muted }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {venueLabel}
          </Text>
        ) : (
          <Text
            style={[styles.cardVenue, { color: colors.muted }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {venueLabel}
          </Text>
        )}

        {onSale && (
          <Text
            style={[styles.onSaleText, { color: colors.faint }]}
            numberOfLines={1}
          >
            {item.onSaleStatus === 'on_sale' ? 'On sale since ' : 'On sale '}
            {onSale}
          </Text>
        )}
      </View>

      {/* Right column — Ticketmaster jump + chevron, mirroring ShowCard. */}
      {ticketUrl ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            void hapticSelection();
            Linking.openURL(ticketUrl).catch(() => {
              showToast({ kind: 'error', text: "Couldn't open Ticketmaster." });
            });
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Open tickets on Ticketmaster"
          testID={`discover-row-tix-${item.id}`}
          style={({ pressed }) => [
            styles.tixPill,
            { borderColor: colors.ruleStrong, backgroundColor: colors.surface },
            pressed && { opacity: 0.6 },
          ]}
        >
          <TicketmasterMark size={16} />
        </Pressable>
      ) : null}

      <View style={styles.chevronContainer}>
        <ChevronRight size={16} color={colors.faint} strokeWidth={2} />
      </View>
    </Pressable>
    <UpcomingAnnouncementActionSheet
      open={sheetOpen}
      onClose={() => setSheetOpen(false)}
      canWatch={canWatch}
      isWatching={isWatching}
      ticketUrl={ticketUrl}
      onToggleWatch={() => {
        void onToggleWatch(item.id, isWatching);
      }}
      onMarkTicketed={() => {
        // Multi-night runs (theatre / comedy / concert) need the user
        // to pick which night they have tickets for before we open the
        // form — otherwise we'd silently default to runStartDate.
        // Festivals are one experience over a date range, so they skip
        // the picker and pre-fill the start date as before.
        if (isDatePickingRun && performanceDates.length > 1) {
          setPickDateOpen(true);
          return;
        }
        navigateToAddForm(item.showDate);
      }}
    />
    {isDatePickingRun && (
      <PickPerformanceDateSheet
        open={pickDateOpen}
        onClose={() => setPickDateOpen(false)}
        title={title}
        performanceDates={performanceDates}
        onPick={(date) => navigateToAddForm(date)}
      />
    )}
    </>
  );
});

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  segmentWrap: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  scrollContent: {
    paddingTop: 4,
    paddingBottom: 48,
  },
  scrollFlex: {
    flexGrow: 1,
    paddingTop: 4,
    paddingBottom: 48,
  },
  emptyHeroWrap: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  summaryText: {
    fontFamily: 'Geist Sans 500',
    fontSize: 11,
    letterSpacing: 11 * 0.06,
    textTransform: 'uppercase',
  },
  // iOS renders ActivityIndicator size="small" at 20pt — scale it down
  // to sit next to the 11pt summary text without dominating the row.
  summarySpinner: {
    transform: [{ scale: 0.7 }],
  },
  list: {
    paddingHorizontal: 16,
    gap: 10,
  },
  inlineEmpty: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  inlineEmptyText: {
    fontFamily: 'Geist Sans 400',
    fontSize: 13,
    lineHeight: 19,
  },
  loadMoreWrap: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  loadMoreButton: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  loadMoreLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 13,
    letterSpacing: -0.1,
  },
  loadMoreMeta: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
  },
  regionGroup: {
    gap: 10,
  },
  regionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 2,
  },
  regionHeaderName: {
    fontFamily: 'Geist Sans 600',
    fontSize: 15,
    letterSpacing: -0.1,
  },
  regionHeaderMeta: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
    textTransform: 'lowercase',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderRadius: RADII.lg,
    paddingVertical: 12,
    paddingRight: 12,
  },
  cardSoldOut: {
    overflow: 'hidden',
  },
  stateBar: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: RADII.pill,
    marginRight: 12,
  },
  dateBlock: {
    minWidth: 50,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: 12,
  },
  dateMonth: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10.5,
    letterSpacing: 1.05,
    textTransform: 'uppercase',
  },
  dateDay: {
    fontFamily: 'Geist Sans 700',
    fontSize: 22,
    lineHeight: 26,
  },
  dateDow: {
    fontFamily: 'Geist Sans 400',
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  dateYear: {
    fontFamily: 'Geist Sans 400',
    fontSize: 9,
    letterSpacing: 0.3,
    marginTop: 1,
  },
  dateRunEnd: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10.5,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    marginTop: 1,
  },
  avatar: {
    alignSelf: 'center',
    marginRight: 10,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'nowrap',
  },
  tixPill: {
    alignSelf: 'center',
    width: 30,
    height: 30,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  chevronContainer: {
    justifyContent: 'center',
    paddingLeft: 8,
  },
  cardTitle: {
    fontFamily: 'Geist Sans 700',
    fontSize: 16,
    lineHeight: 21,
  },
  cardSupport: {
    fontFamily: 'Geist Sans 400',
    fontSize: 13,
    lineHeight: 18,
  },
  cardVenue: {
    fontFamily: 'Geist Sans 400',
    fontSize: 13,
    lineHeight: 18,
  },
  statusBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: RADII.pill,
  },
  statusLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10.5,
    letterSpacing: 10.5 * 0.06,
    textTransform: 'uppercase',
  },
  onSaleText: {
    fontFamily: 'Geist Sans 500',
    fontSize: 11.5,
    letterSpacing: 0.3,
  },
});
