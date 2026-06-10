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
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { ScreenWrapper } from '../../components/ScreenWrapper';
import { EmptyStateHero } from '../../components/design-system';
import { EmptyState } from '../../components/EmptyState';
import { ArtistCard, type ArtistCardArtist } from '../../components/ArtistCard';
import { ListSearchBar } from '../../components/ListSearchBar';
import { RowSkeleton } from '../../components/skeletons';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/lib/auth';
import { trpc, type RouterOutput } from '@/lib/trpc';
import { useCachedQuery } from '@/lib/cache';
import { filterByQuery } from '@/lib/list-search';
import { useDebouncedValue } from '@showbook/shared/hooks';

type UtilsClient = ReturnType<typeof trpc.useUtils>['client'];
type PerformerListRow = RouterOutput<UtilsClient['performers']['list']['query']>[number];
type FollowedPerformerRow = RouterOutput<
  UtilsClient['performers']['followed']['query']
>[number];

export default function ArtistsListScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { token } = useAuth();
  const utils = trpc.useUtils();
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query, 150);

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

  const filtered = React.useMemo(
    () => filterByQuery(merged, debouncedQuery, (a) => [a.name]),
    [merged, debouncedQuery],
  );

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

  return (
    <ScreenWrapper title="Artists" eyebrow="LINEUP" leading={back} large>
      {isLoading ? (
        <View style={styles.skeletonWrap}>
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      ) : isErrored ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            title="Couldn't load artists"
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
            kind="artists"
            title="Build your lineup"
            body="Log a show or follow an artist from Discover and they'll appear here with the rest of your roster."
            action={{ label: 'Open Discover', onPress: () => router.push('/discover') }}
            secondaryAction={{ label: 'Add a show', onPress: () => router.push('/add') }}
          />
        </View>
      ) : (
        <>
          <ListSearchBar
            value={query}
            onChangeText={setQuery}
            placeholder="Filter artists…"
            accessibilityLabel="Filter artists"
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            // Virtualisation tuning for power users with deep rosters —
            // see comment in `app/(tabs)/shows.tsx` for the rationale.
            initialNumToRender={14}
            maxToRenderPerBatch={10}
            windowSize={11}
            removeClippedSubviews
            renderItem={({ item }) => (
              <ArtistCard
                artist={item}
                onPress={() => router.push(`/artists/${item.id}`)}
              />
            )}
            ListHeaderComponent={
              <Text style={[styles.listLabel, { color: colors.muted }]}>
                {filtered.length} {filtered.length === 1 ? 'ARTIST' : 'ARTISTS'}
              </Text>
            }
            ListEmptyComponent={
              <View style={styles.noResults}>
                <Text style={[styles.noResultsText, { color: colors.muted }]}>
                  No artists match “{debouncedQuery.trim()}”.
                </Text>
              </View>
            }
          />
        </>
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
    fontFamily: 'Geist Sans 600',
    fontSize: 10.5,
    letterSpacing: 1.05,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  separator: {
    height: 8,
  },
  noResults: {
    paddingHorizontal: 4,
    paddingTop: 12,
  },
  noResultsText: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    lineHeight: 18,
  },
});
