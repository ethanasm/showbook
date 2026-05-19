/**
 * Discover — bottom-nav tab.
 *
 * Mirrors the web Discover page (apps/web/app/(app)/discover/View.client.tsx):
 * a SegmentedControl across three feeds (Venues / Artists / Regions),
 * and a vertical list of full-width announcement rows underneath. The
 * earlier rail-based layout proved illegible on a phone (every card
 * truncated headliner and venue) — vertical rows trade horizontal
 * density for readable, scannable rows.
 *
 * Data: each tab uses `useCachedQuery` against the same procedures the
 * web shell calls — `discover.followedFeed`, `discover.followedArtistsFeed`,
 * `discover.nearbyFeed`. Pull-to-refresh re-syncs whichever tab is active.
 *
 * Discover feeds joined the offline warm-up scope on 2026-05-19 (see
 * `apps/mobile/CLAUDE.md` "Offline mode" + `lib/cache/warmup.ts`). The
 * screen-level offline gate stays as a safety net: when offline with
 * truly no cached rows (first-launch-before-online or a failed initial
 * warmup) we render `OfflineEmptyState`; otherwise cached rows from a
 * prior online session render so the user gets value when their
 * connection drops.
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
type AnnouncementItem = FollowedFeed['items'][number];

type DiscoverTab = 'venues' | 'artists' | 'regions';

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

export default function DiscoverScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { token } = useAuth();
  const network = useNetwork();
  const utils = trpc.useUtils();
  const [tab, setTab] = React.useState<DiscoverTab>('venues');

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

  const items = activeQuery.data?.items ?? [];
  const nearbyHasRegions =
    tab === 'regions'
      ? (nearbyQuery.data as NearbyFeed | undefined)?.hasRegions ?? null
      : null;

  const showOfflineEmpty = !network.online && !activeQuery.data;
  const isLoading = activeQuery.isLoading;
  const isEmpty = !isLoading && items.length === 0;

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
                {items.length} upcoming · pull to refresh
              </Text>
            </View>
            <View style={styles.list}>
              {items.map((item) => (
                <AnnouncementRow key={item.id} item={item} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenWrapper>
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
          body="Follow a venue from its detail screen to see its announcements here."
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
  scrollContent: {
    paddingTop: 4,
    paddingBottom: 48,
  },
  scrollFlex: {
    flexGrow: 1,
    paddingTop: 4,
    paddingBottom: 48,
  },
  heroWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
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
