/**
 * Venues list — venues the user has shows at, plus followed-only venues.
 *
 * Stack route reachable from Discover and from search results. Mirrors
 * the Artists list shape: merges `venues.list` (venues with at least one
 * user show) with `venues.followed` (raw followed rows). Both go through
 * `useCachedQuery` for warm-start renders.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, MapPin, Search } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { VenueCard, type VenueCardVenue } from '../../components/VenueCard';
import { RowSkeleton } from '../../components/skeletons';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { useTheme } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { trpc } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';

interface VenueListRow {
  id: string;
  name: string;
  city: string | null;
  stateRegion: string | null;
  country: string | null;
  googlePlaceId: string | null;
  photoUrl: string | null;
  ticketmasterVenueId: string | null;
  pastShowsCount: number;
  futureShowsCount: number;
  isFollowed: boolean;
}

interface FollowedVenueRow {
  id: string;
  name: string;
  city: string | null;
  stateRegion: string | null;
  photoUrl: string | null;
}

export default function VenuesListScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const utils = trpc.useUtils();

  const listQuery = useCachedQuery<VenueListRow[]>({
    queryKey: ['mobile', 'venues', 'list'],
    queryFn: () => utils.client.venues.list.query() as unknown as Promise<VenueListRow[]>,
    enabled: Boolean(token),
  });

  const followedQuery = useCachedQuery<FollowedVenueRow[]>({
    queryKey: ['mobile', 'venues', 'followed'],
    queryFn: () =>
      utils.client.venues.followed.query() as unknown as Promise<FollowedVenueRow[]>,
    enabled: Boolean(token),
  });

  const merged = React.useMemo<VenueCardVenue[]>(() => {
    const list = listQuery.data ?? [];
    const followed = followedQuery.data ?? [];
    const seen = new Set<string>(list.map((r) => r.id));
    const followedOnly: VenueCardVenue[] = followed
      .filter((r) => !seen.has(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        stateRegion: r.stateRegion,
        photoUrl: r.photoUrl,
        showCount: 0,
        isFollowed: true,
      }));
    const withShows: VenueCardVenue[] = list
      .map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        stateRegion: r.stateRegion,
        photoUrl: r.photoUrl,
        showCount: r.pastShowsCount + r.futureShowsCount,
        isFollowed: r.isFollowed,
      }))
      .sort((a, b) => (b.showCount ?? 0) - (a.showCount ?? 0));
    return [...followedOnly, ...withShows];
  }, [listQuery.data, followedQuery.data]);

  const isLoading = listQuery.isLoading && followedQuery.isLoading;
  const isFetching = listQuery.isFetching || followedQuery.isFetching;
  const refreshControl = useThemedRefreshControl(isFetching && !isLoading, () => {
    void Promise.all([listQuery.refetch(), followedQuery.refetch()]);
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Venues" eyebrow="STAGES" leading={back} rightAction={searchAction} large />

      {isLoading ? (
        <View style={styles.skeletonWrap}>
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : merged.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon={<MapPin size={40} color={colors.faint} strokeWidth={1.5} />}
            title="No venues yet"
            subtitle="Add a show or follow a venue from Discover and it'll show up here."
          />
        </View>
      ) : (
        <FlatList
          data={merged}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={refreshControl}
          renderItem={({ item }) => (
            <VenueCard
              venue={item}
              onPress={() => router.push(`/venues/${item.id}`)}
            />
          )}
          ListHeaderComponent={
            <Text style={[styles.listLabel, { color: colors.muted }]}>
              {merged.length} {merged.length === 1 ? 'VENUE' : 'VENUES'}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonWrap: {
    paddingTop: 8,
    gap: 8,
  },
  emptyWrap: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 48,
  },
  listLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  separator: {
    height: 8,
  },
});
