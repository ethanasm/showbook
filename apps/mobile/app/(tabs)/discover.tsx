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
import { useRouter } from 'expo-router';
import {
  BookmarkCheck,
  BookmarkPlus,
  Calendar,
  MapPin,
  Search,
  Ticket,
  Users,
} from 'lucide-react-native';
import { useFeedback } from '../../lib/feedback';
import { isNonWatchableKind } from '@showbook/shared';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { SegmentedControl } from '../../components/SegmentedControl';
import { EmptyState } from '../../components/EmptyState';
import { EmptyStateHero } from '../../components/design-system';
import { OfflineEmptyState } from '../../components/OfflineEmptyState';
import { KindBadge } from '../../components/KindBadge';
import { useTheme, type Kind } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { useNetwork } from '../../lib/network';
import { hapticSelection } from '../../lib/haptics';
import { trpc, type RouterOutput } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';
import { useIngestPolling } from '../../lib/discover/useIngestPolling';
import {
  WATCHED_IDS_CACHE_KEY,
  useToggleWatch,
  type WatchToggle,
} from '../../lib/discover-watch';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { MeTopBarAction } from '../../components/MeTopBarAction';
import { PickPerformanceDateSheet } from '../../components/PickPerformanceDateSheet';

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

interface FilterGroup {
  id: string;
  name: string;
  sublabel?: string;
  count: number;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// Cap rendered rows per feed. The chip row and "N upcoming" summary still
// reflect the full filtered set; only the AnnouncementRow tree is sliced.
// With 800+ Region announcements rendered into a non-virtualized ScrollView
// the tab swap stalled for several seconds — paginating the render keeps
// the totals honest without paying that cost.
const PAGE_SIZE = 50;

function parseDate(iso: string): { month: string; day: string; year: string; dow: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return { month: '—', day: '—', year: '—', dow: '' };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const local = new Date(y, mo - 1, d);
  const month = MONTHS[mo - 1] ?? '—';
  const dow = DOWS[local.getDay()] ?? '';
  return { month, day: String(d), year: String(y), dow };
}

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

function formatRunRange(start: string, end: string): string {
  const fmt = (iso: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const month = MONTHS[mo - 1] ?? '';
    return `${month} ${d}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatOnSale(value: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const month = MONTHS[d.getMonth()] ?? '';
  return `${month} ${d.getDate()}`;
}

const ON_SALE_LABEL: Record<AnnouncementItem['onSaleStatus'], string> = {
  announced: 'Announced',
  presale: 'Presale',
  on_sale: 'On sale',
  sold_out: 'Sold out',
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
  const [tab, setTab] = React.useState<DiscoverTab>('venues');
  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);
  // Secondary venue filter for the Regions tab — mirrors the web rail's
  // region → venue drill-down. Always reset when switching tabs or
  // regions so the chip row stays predictable.
  const [selectedRegionVenueId, setSelectedRegionVenueId] = React.useState<
    string | null
  >(null);

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
  }, [tab, selectedGroupId, selectedRegionVenueId]);

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
  const followedVenuesQuery = useCachedQuery<FollowedFeed>({
    queryKey: ['mobile', 'discover', 'followedFeed'],
    queryFn: () => utils.client.discover.followedFeed.query({ limit: 100 }),
    enabled: Boolean(token),
    refetchInterval: ingestPolling.intervals.venues,
  });

  const followedArtistsQuery = useCachedQuery<FollowedFeed>({
    queryKey: ['mobile', 'discover', 'followedArtistsFeed'],
    queryFn: () => utils.client.discover.followedArtistsFeed.query({ limit: 100 }),
    enabled: Boolean(token),
    refetchInterval: ingestPolling.intervals.artists,
  });

  const nearbyQuery = useCachedQuery<NearbyFeed>({
    queryKey: ['mobile', 'discover', 'nearbyFeed'],
    queryFn: () => utils.client.discover.nearbyFeed.query({}),
    enabled: Boolean(token),
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

  const refreshControl = useThemedRefreshControl(
    activeQuery.isFetching && !activeQuery.isLoading,
    () => {
      void activeQuery.refetch();
    },
  );

  const searchAction = (
    <View style={styles.actions}>
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
    return result;
  }, [
    items,
    selectedGroupId,
    selectedRegionVenueId,
    tab,
    followedArtistIdSet,
  ]);

  const showOfflineEmpty = !network.online && !activeQuery.data;
  const isLoading = activeQuery.isLoading;
  const isErrored = !isLoading && activeQuery.isError && !activeQuery.data;
  const isEmpty = !isLoading && !isErrored && items.length === 0;
  const filterCount = filteredItems.length;

  const visibleItems = React.useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount],
  );
  const remainingCount = Math.max(0, filterCount - visibleItems.length);
  const hasMore = remainingCount > 0;

  return (
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
          totalCount={items.length}
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
            onOpenVenues={() => router.push('/venues')}
            onOpenArtists={() => router.push('/artists')}
            onOpenMe={() => router.push('/me')}
          />
        ) : (
          <>
            <View style={styles.summaryRow}>
              <SummaryIcon tab={tab} color={colors.muted} />
              <Text style={[styles.summaryText, { color: colors.muted }]}>
                {filterCount} upcoming · {ingestPolling.isAnyPending ? 'discovering more shows…' : 'pull to refresh'}
              </Text>
            </View>
            {tab === 'regions' && !selectedGroupId ? (
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
  );
}

function FilterChipsRow({
  groups,
  selected,
  onSelect,
  totalCount,
  allLabel = 'All',
  variant = 'primary',
  testIdPrefix,
}: {
  groups: FilterGroup[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  totalCount: number;
  allLabel?: string;
  /** `sub` renders a slightly tighter row used as a second-level filter
   *  under a primary chip row (Regions tab venue chips). */
  variant?: 'primary' | 'sub';
  testIdPrefix?: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[
        styles.chipsRow,
        variant === 'sub' && styles.chipsRowSub,
      ]}
      style={styles.chipsScroll}
      testID={testIdPrefix ? `${testIdPrefix}-row` : undefined}
    >
      <FilterChip
        label={allLabel}
        count={totalCount}
        active={selected === null}
        onPress={() => onSelect(null)}
        colors={colors}
        testID={testIdPrefix ? `${testIdPrefix}-all` : undefined}
      />
      {groups.map((g) => (
        <FilterChip
          key={g.id}
          label={g.name}
          sublabel={g.sublabel}
          count={g.count}
          active={selected === g.id}
          onPress={() => onSelect(selected === g.id ? null : g.id)}
          colors={colors}
          testID={testIdPrefix ? `${testIdPrefix}-${g.id}` : undefined}
        />
      ))}
    </ScrollView>
  );
}

function FilterChip({
  label,
  sublabel,
  count,
  active,
  onPress,
  colors,
  testID,
}: {
  label: string;
  sublabel?: string;
  count: number;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['tokens']['colors'];
  testID?: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}${sublabel ? ` ${sublabel}` : ''}`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? colors.ink : 'transparent',
          borderColor: active ? colors.ink : colors.ruleStrong,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.chipLabel,
          {
            color: active ? colors.bg : colors.ink,
            fontWeight: active ? '600' : '500',
          },
        ]}
      >
        {label}
        {sublabel ? (
          <Text style={[styles.chipSublabel, { color: active ? colors.bg : colors.muted }]}>
            {' '}
            · {sublabel}
          </Text>
        ) : null}
      </Text>
      <Text
        style={[
          styles.chipCount,
          { color: active ? colors.bg : colors.muted, opacity: active ? 0.7 : 1 },
        ]}
      >
        {count}
      </Text>
    </Pressable>
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
  onOpenVenues,
  onOpenArtists,
  onOpenMe,
}: {
  tab: DiscoverTab;
  hasRegions: boolean | null;
  onOpenVenues: () => void;
  onOpenArtists: () => void;
  onOpenMe: () => void;
}): React.JSX.Element {
  if (tab === 'venues') {
    return (
      <View style={styles.emptyHeroWrap}>
        <EmptyStateHero
          kind="venues"
          title="Follow a venue"
          body="Follow a hall, theatre, or dive bar from its detail screen and its upcoming announcements land here as soon as they go on sale."
          action={{ label: 'Open Venues', onPress: onOpenVenues }}
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
          body="Follow an artist to see their tour announcements the moment they go on sale — Spotify import is the fastest way to seed your follow list."
          action={{ label: 'Open Artists', onPress: onOpenArtists }}
        />
      </View>
    );
  }
  if (hasRegions === false) {
    return (
      <View style={styles.emptyHeroWrap}>
        <EmptyStateHero
          kind="discover"
          title="Set your region"
          body="Add a region to surface nearby announcements and power your daily email digest. Up to five fit; start with the city you live in."
          action={{ label: 'Open Settings', onPress: onOpenMe }}
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

/**
 * Renders -45° diagonal stripes scaled to the parent card's measured
 * dimensions. Used as a background layer on sold-out announcements so the
 * row is recognisably struck through without obscuring the text. The
 * comment in this file's header (iOS #263) explains why SVG Pattern/Mask
 * is off the table — we draw explicit <Line> elements instead.
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
  const spacing = 9;
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
        strokeWidth={1}
        opacity={0.5}
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

function AnnouncementRow({
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
  const { month, day, year, dow } = parseDate(item.showDate);
  const accent = tokens.kindColor(item.kind as Kind);
  const onSale = formatOnSale(item.onSaleDate);
  const onSaleLabel = ON_SALE_LABEL[item.onSaleStatus];
  const ticketUrl = item.ticketUrl;
  const isSoldOut = item.onSaleStatus === 'sold_out';
  const runMode = isRun(item);
  const runRangeLabel =
    runMode && item.runStartDate && item.runEndDate
      ? formatRunRange(item.runStartDate, item.runEndDate)
      : null;
  // Festivals are a single experience over a date range; multi-night
  // theatre / comedy / concert runs are N separate performances and
  // need a date pick. Mirrors `discover.watchlist`'s `isDatePickingRun`
  // server-side check.
  const isDatePickingRun = runMode && item.kind !== 'festival';
  const performanceDates = item.performanceDates ?? [];
  const performanceCount = performanceDates.length;
  const [pickDateOpen, setPickDateOpen] = React.useState(false);
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
      ? `${item.kind === 'sports' && item.support.length === 1 ? 'vs' : '+'} ${item.support.join(', ')}`
      : null;
  // Theatre productions use the productionName as the title and don't
  // carry a meaningful headlinerPerformerId for navigation — match the
  // web row which only links when a real performer id is present.
  const headlinerLinkId =
    !item.productionName && item.headlinerPerformerId
      ? item.headlinerPerformerId
      : null;

  const onPress = () => {
    // We don't have an announcement detail screen on mobile yet; for now
    // a tap is a no-op (the row is informational). Long-press could later
    // open a sheet with Add-to-Watchlist + Tickets actions.
  };

  const canWatch = !isNonWatchableKind(item.kind);

  return (
    <>
    <Pressable
      onPress={onPress}
      onLayout={isSoldOut ? onCardLayout : undefined}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.rule,
          borderLeftColor: accent,
        },
        isSoldOut && styles.cardSoldOut,
        pressed && { opacity: 0.9 },
      ]}
    >
      {isSoldOut && (
        <SoldOutStripes
          color={colors.rule}
          width={cardSize.w}
          height={cardSize.h}
        />
      )}
      <View style={styles.cardHeaderRow}>
        {runMode && runRangeLabel ? (
          <View
            style={styles.dateBlockRun}
            testID={`discover-row-run-${item.id}`}
          >
            <Text style={[styles.dateRunRange, { color: colors.ink }]}>
              {runRangeLabel}
            </Text>
            <Text style={[styles.dateRunSub, { color: colors.muted }]}>
              {performanceCount > 0
                ? `${performanceCount} dates · ${year}`
                : year}
            </Text>
          </View>
        ) : (
          <View style={styles.dateBlock}>
            <Text style={[styles.dateMonth, { color: colors.muted }]}>{month}</Text>
            <Text style={[styles.dateDay, { color: colors.ink }]}>{day}</Text>
            <Text style={[styles.dateYear, { color: colors.muted }]}>
              {dow ? `${dow} · ${year}` : year}
            </Text>
          </View>
        )}
        <View style={styles.cardBadge}>
          <KindBadge kind={item.kind as Kind} size="sm" />
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
              <Ticket size={11} color={colors.muted} strokeWidth={2} />
              <Text style={[styles.tixLabel, { color: colors.muted }]}>TIX</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {headlinerLinkId ? (
        <Text
          onPress={() => router.push(`/artists/${headlinerLinkId}`)}
          accessibilityRole="link"
          accessibilityLabel={`Open ${title}`}
          style={[styles.cardTitle, { color: colors.ink }]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {title}
        </Text>
      ) : (
        <Text
          style={[styles.cardTitle, { color: colors.ink }]}
          numberOfLines={2}
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
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {venueLabel}
        </Text>
      ) : (
        <Text
          style={[styles.cardVenue, { color: colors.muted }]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {venueLabel}
        </Text>
      )}

      <View style={styles.metaRow}>
        <View style={styles.metaLeft}>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: accent + '22',
              },
            ]}
          >
            <Text style={[styles.statusLabel, { color: accent }]}>
              {onSaleLabel}
            </Text>
          </View>
          {onSale && (
            <Text
              style={[styles.onSaleText, { color: colors.muted }]}
              numberOfLines={1}
            >
              {item.onSaleStatus === 'on_sale' ? 'Since ' : 'On sale '}
              {onSale}
            </Text>
          )}
        </View>
        {canWatch && (
          <View style={styles.actionsRow}>
            <LabeledIconAction
              label={isWatching ? 'Watching' : 'Watch'}
              onPress={() => {
                void hapticSelection();
                void onToggleWatch(item.id, isWatching);
              }}
              accessibilityLabel={
                isWatching ? 'Stop watching this event' : 'Add to watching'
              }
              testID={`discover-row-watch-${item.id}`}
              active={isWatching}
              accent={accent}
              colors={colors}
            >
              {isWatching ? (
                <BookmarkCheck size={14} color={accent} strokeWidth={2} />
              ) : (
                <BookmarkPlus size={14} color={colors.muted} strokeWidth={2} />
              )}
            </LabeledIconAction>
            {!isWatching && (
              <LabeledIconAction
                label="Got ticket"
                onPress={() => {
                  void hapticSelection();
                  // Multi-night runs (theatre / comedy / concert) need
                  // the user to pick which night they have tickets for
                  // before we open the form — otherwise we'd silently
                  // default to runStartDate. Festivals are one
                  // experience over a date range, so they skip the
                  // picker and pre-fill the start date as before.
                  if (isDatePickingRun && performanceDates.length > 1) {
                    setPickDateOpen(true);
                    return;
                  }
                  navigateToAddForm(item.showDate);
                }}
                accessibilityLabel="Add as ticketed show"
                testID={`discover-row-ticketed-${item.id}`}
                colors={colors}
              >
                <Ticket size={14} color={colors.muted} strokeWidth={2} />
              </LabeledIconAction>
            )}
          </View>
        )}
      </View>
    </Pressable>
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
}

/**
 * Stacked icon + caption used by each announcement row. The visible
 * caption (WATCH / WATCHING / GOT TICKET) disambiguates what the two
 * affordances do — without it the bookmark / ticket icons read as
 * interchangeable and the ticket icon was easy to mistake for "open
 * external ticket page".
 */
function LabeledIconAction({
  label,
  onPress,
  accessibilityLabel,
  testID,
  active,
  accent,
  colors,
  children,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  active?: boolean;
  accent?: string;
  colors: ReturnType<typeof useTheme>['tokens']['colors'];
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation();
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [
        styles.iconAction,
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor:
              active && accent ? `${accent}1f` : colors.surface,
            borderColor:
              active && accent ? `${accent}55` : colors.rule,
          },
        ]}
      >
        {children}
      </View>
      <Text
        style={[
          styles.iconLabel,
          { color: active && accent ? accent : colors.muted },
        ]}
      >
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

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
  chipsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  chipsRowSub: {
    paddingTop: 0,
    paddingBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    maxWidth: 220,
  },
  chipLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    letterSpacing: -0.1,
  },
  chipSublabel: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '400',
  },
  chipCount: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    fontWeight: '400',
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
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 11 * 0.06,
    textTransform: 'uppercase',
  },
  list: {
    paddingHorizontal: 16,
    gap: 10,
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
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  loadMoreLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '600',
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
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  regionHeaderMeta: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
    textTransform: 'lowercase',
  },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    gap: 6,
  },
  cardSoldOut: {
    overflow: 'hidden',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  dateBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  dateBlockRun: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
  },
  dateRunRange: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  dateRunSub: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
    textTransform: 'uppercase',
  },
  dateMonth: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
    textTransform: 'uppercase',
  },
  dateDay: {
    fontFamily: 'Geist Sans',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
  },
  dateYear: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  cardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tixPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tixLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  cardTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 2,
  },
  cardSupport: {
    fontFamily: 'Geist Sans',
    fontSize: 12.5,
    fontWeight: '400',
    lineHeight: 17,
  },
  cardVenue: {
    fontFamily: 'Geist Sans',
    fontSize: 12.5,
    fontWeight: '400',
    lineHeight: 17,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 4,
  },
  metaLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconAction: {
    alignItems: 'center',
    gap: 4,
    minWidth: 44,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 8.5,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statusBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  statusLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 10.5 * 0.06,
    textTransform: 'uppercase',
  },
  onSaleText: {
    fontFamily: 'Geist Sans',
    fontSize: 11.5,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
});
