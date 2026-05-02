/**
 * Discover — stack route reachable from Home.
 *
 * NOT a sixth tab. The mobile-m2-m6-plan called Discover an option-(c)
 * Stack route to avoid disturbing the (tabs) bar; we go with that here.
 *
 * Composition:
 *   - "Followed venues" rail — announcements at the user's followed venues
 *   - "Followed artists" rail — announcements headlined by followed artists
 *   - "Nearby" rail — announcements in the user's saved regions
 *
 * Friends-watching is intentionally omitted: the discover router doesn't
 * expose that data, so per the M5 prompt we don't stub it.
 *
 * Data: each rail uses `useCachedQuery` so the persistent QueryClient
 * cache hydrates the screen instantly between launches; pull-to-refresh
 * triggers a re-sync of all three.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  Compass,
  Calendar,
  MapPin,
  Search,
  Users,
} from 'lucide-react-native';
import { TopBar } from '../components/TopBar';
import { EmptyState } from '../components/EmptyState';
import { KindBadge } from '../components/KindBadge';
import { useTheme, type Kind } from '../lib/theme';
import { useAuth } from '../lib/auth';
import { trpc } from '../lib/trpc';
import { useCachedQuery } from '../lib/cache';
import { useThemedRefreshControl } from '../components/PullToRefresh';

interface AnnouncementVenue {
  id: string;
  name: string;
  city: string | null;
  stateRegion?: string | null;
}

interface AnnouncementItem {
  id: string;
  kind: Kind;
  headliner: string;
  productionName: string | null;
  showDate: string;
  venue: AnnouncementVenue;
  ticketUrl: string | null;
}

interface FeedShape {
  items: AnnouncementItem[];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function parseDate(iso: string): { month: string; day: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return { month: '—', day: '—' };
  const month = MONTHS[Number(m[2]) - 1] ?? '—';
  return { month, day: String(Number(m[3])) };
}

export default function DiscoverScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const utils = trpc.useUtils();

  const followedVenuesQuery = useCachedQuery<FeedShape>({
    queryKey: ['mobile', 'discover', 'followedFeed'],
    queryFn: async () => {
      const data = await utils.client.discover.followedFeed.query({ limit: 12 });
      return { items: data.items as unknown as AnnouncementItem[] };
    },
    enabled: Boolean(token),
  });

  const followedArtistsQuery = useCachedQuery<FeedShape>({
    queryKey: ['mobile', 'discover', 'followedArtistsFeed'],
    queryFn: async () => {
      const data = await utils.client.discover.followedArtistsFeed.query({ limit: 12 });
      return { items: data.items as unknown as AnnouncementItem[] };
    },
    enabled: Boolean(token),
  });

  const nearbyQuery = useCachedQuery<FeedShape>({
    queryKey: ['mobile', 'discover', 'nearbyFeed'],
    queryFn: async () => {
      const data = await utils.client.discover.nearbyFeed.query({ perRegionLimit: 8 });
      return { items: data.items as unknown as AnnouncementItem[] };
    },
    enabled: Boolean(token),
  });

  const isAnyFetching =
    followedVenuesQuery.isFetching ||
    followedArtistsQuery.isFetching ||
    nearbyQuery.isFetching;
  const isAllLoading =
    followedVenuesQuery.isLoading &&
    followedArtistsQuery.isLoading &&
    nearbyQuery.isLoading;

  const refreshControl = useThemedRefreshControl(isAnyFetching && !isAllLoading, () => {
    void Promise.all([
      followedVenuesQuery.refetch(),
      followedArtistsQuery.refetch(),
      nearbyQuery.refetch(),
    ]);
  });

  const back = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  const searchAction = (
    <Pressable
      onPress={() => router.push('/search')}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Search"
    >
      <Search size={20} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  const followedVenues = followedVenuesQuery.data?.items ?? [];
  const followedArtists = followedArtistsQuery.data?.items ?? [];
  const nearby = nearbyQuery.data?.items ?? [];
  const allEmpty =
    !isAllLoading &&
    followedVenues.length === 0 &&
    followedArtists.length === 0 &&
    nearby.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Discover" eyebrow="WHAT'S COMING UP" leading={back} rightAction={searchAction} large />

      <ScrollView
        contentContainerStyle={
          isAllLoading || allEmpty ? styles.scrollFlex : styles.scrollContent
        }
        refreshControl={refreshControl}
      >
        {isAllLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : allEmpty ? (
          <EmptyState
            icon={<Compass size={40} color={colors.faint} strokeWidth={1.5} />}
            title="Nothing to discover yet"
            subtitle="Follow a venue or an artist to see upcoming announcements here, or add a region from the Me tab."
          />
        ) : (
          <>
            <Rail
              title="Followed venues"
              icon={<MapPin size={13} color={colors.ink} strokeWidth={2} />}
              items={followedVenues}
              emptyHint="Follow a venue from its detail screen to see its announcements here."
            />
            <Rail
              title="Followed artists"
              icon={<Users size={13} color={colors.ink} strokeWidth={2} />}
              items={followedArtists}
              emptyHint="Follow an artist from the Artists tab to see their tour announcements."
            />
            <Rail
              title="Near you"
              icon={<Calendar size={13} color={colors.ink} strokeWidth={2} />}
              items={nearby}
              emptyHint={
                nearbyQuery.data && (nearbyQuery.data as unknown as { hasRegions?: boolean }).hasRegions === false
                  ? 'Add a region in Me → Region to see shows in your area.'
                  : 'No upcoming announcements in your saved regions yet.'
              }
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Rail({
  title,
  icon,
  items,
  emptyHint,
}: {
  title: string;
  icon: React.ReactNode;
  items: AnnouncementItem[];
  emptyHint: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={[styles.sectionTitle, { color: colors.ink }]}>{title.toUpperCase()}</Text>
      </View>
      {items.length === 0 ? (
        <View
          style={[
            styles.emptyCard,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          <Text style={[styles.emptyHint, { color: colors.muted }]}>{emptyHint}</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        >
          {items.map((item) => (
            <AnnouncementCard key={item.id} item={item} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function AnnouncementCard({ item }: { item: AnnouncementItem }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { month, day } = parseDate(item.showDate);
  const accent = tokens.kindColor(item.kind);

  const title = item.productionName ?? item.headliner;
  const venueLabel = [item.venue.name, item.venue.city].filter(Boolean).join(' · ');

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.rule,
          borderLeftColor: accent,
        },
      ]}
    >
      <View style={styles.cardDate}>
        <Text style={[styles.cardMonth, { color: colors.muted }]}>{month}</Text>
        <Text style={[styles.cardDay, { color: colors.ink }]}>{day}</Text>
      </View>
      <View style={styles.cardBadge}>
        <KindBadge kind={item.kind} size="sm" />
      </View>
      <Text style={[styles.cardTitle, { color: colors.ink }]} numberOfLines={2} ellipsizeMode="tail">
        {title}
      </Text>
      <Text style={[styles.cardVenue, { color: colors.muted }]} numberOfLines={2} ellipsizeMode="tail">
        {venueLabel}
      </Text>
    </View>
  );
}

const CARD_WIDTH = 220;

const styles = StyleSheet.create({
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 48,
  },
  scrollFlex: {
    flexGrow: 1,
    paddingTop: 8,
    paddingBottom: 48,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    paddingTop: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  sectionTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 11 * 0.08,
    textTransform: 'uppercase',
  },
  rail: {
    paddingHorizontal: 16,
    gap: 10,
  },
  emptyCard: {
    marginHorizontal: 20,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  emptyHint: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  card: {
    width: CARD_WIDTH,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    gap: 6,
  },
  cardDate: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  cardMonth: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
    textTransform: 'uppercase',
  },
  cardDay: {
    fontFamily: 'Geist Sans',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
  },
  cardBadge: {
    flexDirection: 'row',
  },
  cardTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 2,
  },
  cardVenue: {
    fontFamily: 'Geist Sans',
    fontSize: 12.5,
    fontWeight: '400',
    lineHeight: 17,
  },
});
