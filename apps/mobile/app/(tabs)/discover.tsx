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
 * Empty-state note: uses `EmptyStateHero` (full-bleed editorial card with
 * GlowBackdrop + StackedCards + accent-coloured tail title) so the queue
 * matches the home / shows / venues / artists screens visually. The earlier
 * "Unimplemented component: <ViewManagerAdapter_ExpoLinearGradient>" red
 * placeholder + the show-detail crash were both stale-binary / nested-
 * MaskedView regressions fixed in their own packages (#263 dropped fragile
 * SVG passes; the GradientEmphasis rewrite stopped mounting MaskedView
 * inside a `<Text>` parent); Discover no longer has to dodge them.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Calendar, MapPin, Search, Users } from 'lucide-react-native';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { SegmentedControl } from '../../components/SegmentedControl';
import { EmptyState } from '../../components/EmptyState';
import { EmptyStateHero } from '../../components/design-system';
import { OfflineEmptyState } from '../../components/OfflineEmptyState';
import { KindBadge } from '../../components/KindBadge';
import { useTheme, type Kind } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { useNetwork } from '../../lib/network';
import { trpc, type RouterOutput } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { MeTopBarAction } from '../../components/MeTopBarAction';

type UtilsClient = ReturnType<typeof trpc.useUtils>['client'];
type FollowedFeed = RouterOutput<UtilsClient['discover']['followedFeed']['query']>;
type NearbyFeed = RouterOutput<UtilsClient['discover']['nearbyFeed']['query']>;
type FollowedVenues = RouterOutput<UtilsClient['venues']['followed']['query']>;
type FollowedPerformers = RouterOutput<UtilsClient['performers']['followed']['query']>;
type PreferencesPayload = RouterOutput<UtilsClient['preferences']['get']['query']>;
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

function formatOnSale(value: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const month = MONTHS[d.getMonth()] ?? '';
  return `${month} ${d.getDate()}`;
}

const ON_SALE_LABEL: Record<AnnouncementItem['onSaleStatus'], string> = {
  announced: 'Announced',
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
  // Regions tab only: second-level filter by venue id (across the selected
  // region — or across every region when no region chip is active). null =
  // "All venues" within whatever region scope the top row picked.
  const [selectedRegionVenueId, setSelectedRegionVenueId] = React.useState<
    string | null
  >(null);

  // Clear filter when switching tabs — chips reset per-tab.
  React.useEffect(() => {
    setSelectedGroupId(null);
    setSelectedRegionVenueId(null);
  }, [tab]);

  // Reset the venue sub-filter whenever the region scope changes; the venue
  // list itself is region-dependent so a stale id would silently filter to
  // nothing.
  React.useEffect(() => {
    setSelectedRegionVenueId(null);
  }, [selectedGroupId]);

  const followedVenuesQuery = useCachedQuery<FollowedFeed>({
    queryKey: ['mobile', 'discover', 'followedFeed'],
    queryFn: () => utils.client.discover.followedFeed.query({ limit: 50 }),
    enabled: Boolean(token),
  });

  const followedArtistsQuery = useCachedQuery<FollowedFeed>({
    queryKey: ['mobile', 'discover', 'followedArtistsFeed'],
    queryFn: () => utils.client.discover.followedArtistsFeed.query({ limit: 50 }),
    enabled: Boolean(token),
  });

  const nearbyQuery = useCachedQuery<NearbyFeed>({
    queryKey: ['mobile', 'discover', 'nearbyFeed'],
    queryFn: () => utils.client.discover.nearbyFeed.query({ perRegionLimit: 25 }),
    enabled: Boolean(token),
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

  const filteredItems = React.useMemo(() => {
    let next = items;
    if (selectedGroupId) {
      next = next.filter((item) =>
        getGroupKeys(item, tab, followedArtistIdSet).includes(selectedGroupId),
      );
    }
    // Regions tab: second-level venue filter narrows the set further. Empty
    // when no region or no venue is picked.
    if (tab === 'regions' && selectedRegionVenueId) {
      next = next.filter((item) => item.venue.id === selectedRegionVenueId);
    }
    return next;
  }, [items, selectedGroupId, selectedRegionVenueId, tab, followedArtistIdSet]);

  // Regions tab only: venue chips for the venues that surfaced in the
  // currently-scoped region (or across all followed regions when "All"
  // regions is selected). Counts are derived from the *region-filtered*
  // items so the chip number always matches what shows below.
  const regionVenueChips = React.useMemo<FilterGroup[]>(() => {
    if (tab !== 'regions') return [];
    const scoped = selectedGroupId
      ? items.filter((item) =>
          getGroupKeys(item, 'regions', null).includes(selectedGroupId),
        )
      : items;
    const seen = new Map<string, FilterGroup>();
    for (const item of scoped) {
      const venueId = item.venue.id;
      if (!venueId) continue;
      if (!seen.has(venueId)) {
        seen.set(venueId, {
          id: venueId,
          name: item.venue.name,
          sublabel: item.venue.city,
          count: 0,
        });
      }
      seen.get(venueId)!.count++;
    }
    return Array.from(seen.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  }, [items, selectedGroupId, tab]);

  const showOfflineEmpty = !network.online && !activeQuery.data;
  const isLoading = activeQuery.isLoading;
  const isErrored = !isLoading && activeQuery.isError && !activeQuery.data;
  const isEmpty = !isLoading && !isErrored && items.length === 0;
  const filterCount = filteredItems.length;

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

      {/* Regions tab — second-level filter: venues within the scoped region
          (or across all regions when "All" is active above). Hidden until
          we actually have venue announcements to filter to. */}
      {!showOfflineEmpty &&
        !isLoading &&
        !isEmpty &&
        tab === 'regions' &&
        regionVenueChips.length > 0 && (
          <FilterChipsRow
            groups={regionVenueChips}
            selected={selectedRegionVenueId}
            onSelect={setSelectedRegionVenueId}
            totalCount={regionVenueChips.reduce((sum, g) => sum + g.count, 0)}
            allLabel="All venues"
            variant="sub"
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
                {filterCount} upcoming · pull to refresh
              </Text>
            </View>
            {tab === 'regions' && !selectedGroupId && !selectedRegionVenueId ? (
              <RegionGroupedList
                items={filteredItems as NearbyAnnouncementItem[]}
                groups={groupList}
              />
            ) : (
              <View style={styles.list}>
                {filteredItems.map((item) => (
                  <AnnouncementRow key={item.id} item={item} />
                ))}
              </View>
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
}: {
  groups: FilterGroup[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  totalCount: number;
  /** Label for the "no-filter" chip. Defaults to "All". */
  allLabel?: string;
  /** Visual style. `sub` renders a slightly tighter row used as a second-
   *  level filter under a primary row (Regions tab venue chips). */
  variant?: 'primary' | 'sub';
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.chipsRow, variant === 'sub' && styles.chipsRowSub]}
      style={styles.chipsScroll}
    >
      <FilterChip
        label={allLabel}
        count={totalCount}
        active={selected === null}
        onPress={() => onSelect(null)}
        colors={colors}
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
}: {
  label: string;
  sublabel?: string;
  count: number;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['tokens']['colors'];
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}${sublabel ? ` ${sublabel}` : ''}`}
      onPress={onPress}
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

function RegionGroupedList({
  items,
  groups,
}: {
  items: NearbyAnnouncementItem[];
  groups: FilterGroup[];
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
              <AnnouncementRow key={item.id} item={item} />
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
      <View style={styles.heroWrap}>
        <EmptyStateHero
          kind="discover"
          title="Follow a venue"
          body="Follow a venue from its detail screen to see its upcoming announcements here."
          action={{ label: 'Open Venues', onPress: onOpenVenues }}
        />
      </View>
    );
  }
  if (tab === 'artists') {
    return (
      <View style={styles.heroWrap}>
        <EmptyStateHero
          kind="discover"
          title="Follow an artist"
          body="Follow an artist to see their tour announcements as soon as they go on sale."
          action={{ label: 'Open Artists', onPress: onOpenArtists }}
        />
      </View>
    );
  }
  if (hasRegions === false) {
    return (
      <View style={styles.heroWrap}>
        <EmptyStateHero
          kind="discover"
          title="Set your region"
          body="Add a region to surface nearby announcements and power your daily email digest."
          action={{ label: 'Open Settings', onPress: onOpenMe }}
        />
      </View>
    );
  }
  return (
    <View style={styles.heroWrap}>
      <EmptyStateHero
        kind="discover"
        title="Quiet week"
        body="No new announcements in your saved regions yet. Check back after the next ingest."
      />
    </View>
  );
}

function AnnouncementRow({ item }: { item: AnnouncementItem }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { month, day, year, dow } = parseDate(item.showDate);
  const accent = tokens.kindColor(item.kind as Kind);
  const onSale = formatOnSale(item.onSaleDate);
  const onSaleLabel = ON_SALE_LABEL[item.onSaleStatus];
  const title = item.productionName ?? item.headliner;
  const venueLabel = [item.venue.name, item.venue.city].filter(Boolean).join(' · ');
  const support =
    item.support && item.support.length > 0
      ? `${item.kind === 'sports' && item.support.length === 1 ? 'vs' : '+'} ${item.support.join(', ')}`
      : null;

  const onPress = () => {
    // We don't have an announcement detail screen on mobile yet; for now
    // a tap is a no-op (the row is informational). Long-press could later
    // open a sheet with Add-to-Watchlist + Tickets actions.
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.rule,
          borderLeftColor: accent,
        },
        pressed && { opacity: 0.9 },
      ]}
    >
      <View style={styles.cardHeaderRow}>
        <View style={styles.dateBlock}>
          <Text style={[styles.dateMonth, { color: colors.muted }]}>{month}</Text>
          <Text style={[styles.dateDay, { color: colors.ink }]}>{day}</Text>
          <Text style={[styles.dateYear, { color: colors.muted }]}>
            {dow ? `${dow} · ${year}` : year}
          </Text>
        </View>
        <View style={styles.cardBadge}>
          <KindBadge kind={item.kind as Kind} size="sm" />
        </View>
      </View>

      <Text
        style={[styles.cardTitle, { color: colors.ink }]}
        numberOfLines={2}
        ellipsizeMode="tail"
      >
        {title}
      </Text>
      {support && (
        <Text
          style={[styles.cardSupport, { color: colors.muted }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {support}
        </Text>
      )}
      <Text
        style={[styles.cardVenue, { color: colors.muted }]}
        numberOfLines={2}
        ellipsizeMode="tail"
      >
        {venueLabel}
      </Text>

      <View style={styles.metaRow}>
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
          <Text style={[styles.onSaleText, { color: colors.muted }]}>
            {item.onSaleStatus === 'on_sale' ? 'Since ' : 'On sale '}
            {onSale}
          </Text>
        )}
      </View>
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
  heroWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
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
    gap: 10,
    marginTop: 4,
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
