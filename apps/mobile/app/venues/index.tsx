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
import { useRouter } from 'expo-router';
import { ChevronLeft, Search } from 'lucide-react-native';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { EmptyStateHero } from '../../components/design-system';
import { EmptyState } from '../../components/EmptyState';
import { VenueCard, type VenueCardVenue } from '../../components/VenueCard';
import { RowSkeleton } from '../../components/skeletons';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { useTheme } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { trpc, type RouterOutput } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';

type UtilsClient = ReturnType<typeof trpc.useUtils>['client'];
type VenueListRow = RouterOutput<UtilsClient['venues']['list']['query']>[number];
type FollowedVenueRow = RouterOutput<UtilsClient['venues']['followed']['query']>[number];

export default function VenuesListScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { token } = useAuth();
  const utils = trpc.useUtils();

  const listQuery = useCachedQuery<VenueListRow[]>({
    queryKey: ['mobile', 'venues', 'list'],
    queryFn: () => utils.client.venues.list.query(),
    enabled: Boolean(token),
  });

  const followedQuery = useCachedQuery<FollowedVenueRow[]>({
    queryKey: ['mobile', 'venues', 'followed'],
    queryFn: () => utils.client.venues.followed.query(),
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
  const isErrored =
    !isLoading &&
    listQuery.isError &&
    followedQuery.isError &&
    !listQuery.data &&
    !followedQuery.data;
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
    <ScreenWrapper title="Venues" eyebrow="STAGES" leading={back} rightAction={searchAction} large>
      {isLoading ? (
        <View style={styles.skeletonWrap}>
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : isErrored ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            title="Couldn't load venues"
            subtitle="Tap to try again."
            cta={{
              label: 'Try again',
              onPress: () => {
                void Promise.all([
                  listQuery.refetch(),
                  followedQuery.refetch(),
                ]);
              },
            }}
          />
        </View>
      ) : merged.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyStateHero
            kind="venues"
            title="Map your stages"
            body="Halls, theatres, dive bars, festival grounds — every venue you've played a part of joins the list as soon as you log a show."
            action={{ label: 'Open Discover', onPress: () => router.push('/discover') }}
            secondaryAction={{ label: 'Add a show', onPress: () => router.push('/add') }}
          />
        </View>
      ) : (
        <FlatList
          data={merged}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={refreshControl}
          // Virtualisation tuning for power users with deep stages —
          // see comment in `app/(tabs)/shows.tsx` for the rationale.
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          windowSize={11}
          removeClippedSubviews
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
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  skeletonWrap: {
    paddingTop: 8,
    gap: 8,
  },
  emptyWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
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
