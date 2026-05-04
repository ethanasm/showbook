/**
 * Artists list — followed performers + performers tagged in the user's shows.
 *
 * Stack route reachable from Discover and from search results. Renders a
 * scrollable list of `ArtistCard`s sorted by most recent appearance, with
 * followed-only entries (no shows yet) appended at the top so they don't
 * fall off the bottom.
 *
 * Data: merges `performers.list` (artists with at least one user show) with
 * `performers.followed` (raw followed rows). Both flow through
 * `useCachedQuery` for instant warm-start renders.
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
import { ChevronLeft, Users, Search } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { ArtistCard, type ArtistCardArtist } from '../../components/ArtistCard';
import { RowSkeleton } from '../../components/skeletons';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { useTheme } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { trpc, type RouterOutput } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';

type UtilsClient = ReturnType<typeof trpc.useUtils>['client'];
type PerformerListRow = RouterOutput<UtilsClient['performers']['list']['query']>[number];
type FollowedPerformerRow = RouterOutput<
  UtilsClient['performers']['followed']['query']
>[number];

export default function ArtistsListScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const utils = trpc.useUtils();

  const listQuery = useCachedQuery<PerformerListRow[]>({
    queryKey: ['mobile', 'artists', 'list'],
    queryFn: () => utils.client.performers.list.query(),
    enabled: Boolean(token),
  });

  const followedQuery = useCachedQuery<FollowedPerformerRow[]>({
    queryKey: ['mobile', 'artists', 'followed'],
    queryFn: () => utils.client.performers.followed.query(),
    enabled: Boolean(token),
  });

  const merged = React.useMemo<ArtistCardArtist[]>(() => {
    const list = listQuery.data ?? [];
    const followed = followedQuery.data ?? [];
    const seen = new Set<string>(list.map((r) => r.id));
    const followedOnly: ArtistCardArtist[] = followed
      .filter((r) => !seen.has(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        imageUrl: r.imageUrl ?? null,
        showCount: 0,
        lastSeen: null,
        isFollowed: true,
      }));
    const withShows: ArtistCardArtist[] = list.map((r) => ({
      id: r.id,
      name: r.name,
      imageUrl: r.imageUrl ?? null,
      showCount: r.showCount,
      lastSeen: r.lastSeen,
      isFollowed: r.isFollowed,
    }));
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
      <TopBar title="Artists" eyebrow="LINEUP" leading={back} rightAction={searchAction} large />

      {isLoading ? (
        <View style={styles.skeletonWrap}>
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : merged.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon={<Users size={40} color={colors.faint} strokeWidth={1.5} />}
            title="No artists yet"
            subtitle="Add a show or follow an artist from Discover and they'll show up here."
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
            <ArtistCard
              artist={item}
              onPress={() => router.push(`/artists/${item.id}`)}
            />
          )}
          ListHeaderComponent={
            <Text style={[styles.listLabel, { color: colors.muted }]}>
              {merged.length} {merged.length === 1 ? 'ARTIST' : 'ARTISTS'}
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
