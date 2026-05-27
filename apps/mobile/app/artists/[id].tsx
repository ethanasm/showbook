/**
 * Artist detail.
 *
 * Sections (per M5 prompt):
 *   - Hero: avatar/initial, name, show count + first/last seen
 *   - Tour rail: deferred (no public discover-by-performer procedure today;
 *     this would consume `discover.followedArtistsFeed` which is scoped to
 *     followed artists only)
 *   - Your shows: list of `ShowCard`s that include this performer
 *   - Tagged photos & videos: M4 stub via `EmptyState`
 *
 * Data: `performers.detail` + `performers.userShows`, both via
 * `useCachedQuery`.
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
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Link } from 'expo-router';
import { ChevronLeft, AlertCircle, Image as ImageIcon, Music } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { Eyebrow, GradientEmphasis, RemoteImage } from '../../components/design-system';
import { QueryBoundary } from '../../components/QueryBoundary';
import { ShowCard, type ShowCardShow } from '../../components/ShowCard';
import { SpotifyMark } from '../../components/BrandIcons';
import { MediaGrid, type MediaGridItem } from '../../components/MediaGrid';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { useTheme, type Kind, type ShowState } from '../../lib/theme';
import { hapticSelection } from '../../lib/haptics';
import { isNonWatchableKind } from '@showbook/shared';
import { useAuth } from '../../lib/auth';
import { useSpotifyConnection } from '../../lib/spotify-connection';
import { headlinerDisplayName } from '../../lib/show-display';
import { trpc, type RouterOutput } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';
import { useQueryClient } from '@tanstack/react-query';
import { runOptimisticMutation } from '../../lib/mutations';
import { getCacheOutbox } from '../../lib/cache/db';
import { useFeedback } from '../../lib/feedback';
import { performerImageSource } from '../../lib/images';

// Derive screen types from the tRPC vanilla client so drift in the server
// contract is caught at the call site instead of papered over with casts.
type UtilsClient = ReturnType<typeof trpc.useUtils>['client'];
type PerformerDetail = RouterOutput<UtilsClient['performers']['detail']['query']>;
type UserShow = RouterOutput<UtilsClient['performers']['userShows']['query']>[number];
type TaggedMedia = RouterOutput<UtilsClient['media']['listForPerformer']['query']>[number];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function toShowCard(s: UserShow): ShowCardShow {
  let month = '—';
  let day = '—';
  let dow = '—';
  let year = '';
  if (s.date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.date);
    if (m) {
      const monthIdx = Number(m[2]) - 1;
      const d = new Date(Number(m[1]), monthIdx, Number(m[3]));
      month = MONTHS[monthIdx] ?? '—';
      day = String(Number(m[3]));
      dow = DOWS[d.getDay()] ?? '—';
      year = m[1];
    }
  }
  const headliner = headlinerDisplayName({
    kind: s.kind,
    productionName: s.productionName,
    performers: s.showPerformers.map((sp) => ({
      name: sp.performer.name,
      role: sp.role,
      sortOrder: sp.sortOrder,
    })),
    fallback: s.showPerformers[0]?.performer.name ?? 'Untitled show',
  });
  const kind: Kind = isNonWatchableKind(s.kind) ? 'concert' : (s.kind as Kind);
  return {
    id: s.id,
    kind,
    state: s.state as ShowState,
    headliner,
    venue: s.venue.name,
    city: s.venue.city,
    month,
    day,
    dow,
    year,
    seat: s.seat,
    price: s.pricePaid,
  };
}

function formatRangeLabel(performer: PerformerDetail): string | null {
  if (!performer.firstSeen && !performer.lastSeen) return null;
  if (performer.firstSeen && performer.lastSeen) {
    const firstYear = performer.firstSeen.slice(0, 4);
    const lastYear = performer.lastSeen.slice(0, 4);
    if (firstYear === lastYear) return firstYear;
    return `${firstYear} – ${lastYear}`;
  }
  return (performer.firstSeen ?? performer.lastSeen)?.slice(0, 4) ?? null;
}

export default function ArtistDetailScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const performerId = typeof params.id === 'string' ? params.id : '';
  const { token } = useAuth();
  const utils = trpc.useUtils();

  const detailQuery = useCachedQuery<PerformerDetail>({
    queryKey: ['mobile', 'artist', performerId, 'detail'],
    queryFn: () => utils.client.performers.detail.query({ performerId }),
    enabled: Boolean(token) && performerId.length > 0,
  });

  const showsQuery = useCachedQuery<UserShow[]>({
    queryKey: ['mobile', 'artist', performerId, 'shows'],
    queryFn: () => utils.client.performers.userShows.query({ performerId }),
    enabled: Boolean(token) && performerId.length > 0,
  });

  const mediaQuery = useCachedQuery<TaggedMedia[]>({
    queryKey: ['mobile', 'artist', performerId, 'media'],
    queryFn: () => utils.client.media.listForPerformer.query({ performerId }),
    enabled: Boolean(token) && performerId.length > 0,
  });

  const back = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/artists'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  const performer = detailQuery.data;
  const shows = showsQuery.data ?? [];
  const refreshControl = useThemedRefreshControl(
    (detailQuery.isFetching || showsQuery.isFetching || mediaQuery.isFetching) &&
      !(detailQuery.isLoading && showsQuery.isLoading && mediaQuery.isLoading),
    () => {
      void Promise.all([
        detailQuery.refetch(),
        showsQuery.refetch(),
        mediaQuery.refetch(),
      ]);
    },
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title={performer?.name ?? 'Artist'}
        eyebrow={performer?.isFollowed ? 'FOLLOWING' : 'ARTIST'}
        leading={back}
      />

      <QueryBoundary
        query={detailQuery}
        loading={
          <View style={styles.center}>
            <ActivityIndicator color={colors.muted} />
          </View>
        }
        error={(err, retry) => (
          <View style={styles.center}>
            <EmptyState
              icon={<AlertCircle size={40} color={colors.faint} strokeWidth={1.5} />}
              title="Couldn't load artist"
              subtitle={
                (err as { message?: string } | null)?.message ?? 'Try again in a moment.'
              }
              cta={{ label: 'Retry', onPress: retry }}
            />
          </View>
        )}
      >
        {(performer) => (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={refreshControl}
          >
            <Hero performer={performer} performerId={performerId} />
            <YourShows shows={shows} loading={showsQuery.isLoading} />
            <TaggedPhotos
              items={mediaQuery.data ?? []}
              loading={mediaQuery.isLoading}
            />
          </ScrollView>
        )}
      </QueryBoundary>
    </View>
  );
}

function Hero({
  performer,
  performerId,
}: {
  performer: PerformerDetail;
  performerId: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { token } = useAuth();
  const source = performerImageSource(
    { id: performerId, imageUrl: performer.imageUrl },
    token,
  );
  const range = formatRangeLabel(performer);
  const summary = [
    performer.showCount > 0
      ? `${performer.showCount} show${performer.showCount === 1 ? '' : 's'}`
      : null,
    range,
  ]
    .filter(Boolean)
    .join(' · ');

  // Pull the last word of the name into the gradient emphasis to match
  // the web title treatment. Single-word names get the gradient applied
  // to the whole name.
  const parts = performer.name.trim().split(/\s+/);
  const head = parts.length > 1 ? parts.slice(0, -1).join(' ') + ' ' : '';
  const tail = parts.length > 1 ? (parts[parts.length - 1] as string) : performer.name;

  return (
    <View style={styles.heroWrap}>
      <RemoteImage
        uri={source?.uri}
        headers={source?.headers}
        name={performer.name}
        kind="concert"
        size="hero"
        aspect="16/9"
        style={styles.heroBanner}
        accessibilityLabel={`${performer.name} hero image`}
      />
      <View style={styles.heroBody}>
        <Eyebrow>{performer.isFollowed ? 'FOLLOWING · ARTIST' : 'ARTIST'}</Eyebrow>
        <Text style={[styles.heroTitle, { color: colors.ink }]} numberOfLines={2}>
          {head ? <Text>{head}</Text> : null}
          <GradientEmphasis style={[styles.heroTitle, { color: colors.accent }]}>
            {tail}
          </GradientEmphasis>
        </Text>
        {summary ? <Text style={[styles.heroSummary, { color: colors.muted }]}>{summary}</Text> : null}
        <View style={styles.heroActions}>
          <FollowArtistButton performerId={performerId} isFollowed={performer.isFollowed} />
          <OpenInSpotifyButton
            spotifyArtistId={performer.spotifyArtistId}
            performerName={performer.name}
          />
        </View>
      </View>
    </View>
  );
}

function OpenInSpotifyButton({
  spotifyArtistId,
  performerName,
}: {
  spotifyArtistId: string | null;
  performerName: string;
}): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { connection } = useSpotifyConnection();

  if (!spotifyArtistId) return null;
  if (connection.status !== 'connected') return null;

  const open = async (): Promise<void> => {
    void hapticSelection();
    const nativeUrl = `spotify://artist/${spotifyArtistId}`;
    const webUrl = `https://open.spotify.com/artist/${spotifyArtistId}`;
    // Mirrors HypePlaylistCard: try the native scheme first and fall back
    // when the Spotify app isn't installed. `Linking.canOpenURL` requires
    // an iOS LSApplicationQueriesSchemes / Android <queries> declaration
    // which we don't keep in sync, so the openURL rejection is the signal.
    try {
      await Linking.openURL(nativeUrl);
      return;
    } catch {
      // Spotify app not installed — fall through to the web URL.
    }
    try {
      await WebBrowser.openBrowserAsync(webUrl);
    } catch {
      await Linking.openURL(webUrl);
    }
  };

  return (
    <Pressable
      onPress={() => {
        void open();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Open ${performerName} on Spotify`}
      testID="artist-open-in-spotify"
      style={({ pressed }) => [
        styles.spotifyButton,
        {
          backgroundColor: colors.surface,
          borderColor: colors.rule,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <SpotifyMark size={14} />
      <Text style={[styles.spotifyLabel, { color: colors.ink }]}>
        OPEN IN SPOTIFY
      </Text>
    </Pressable>
  );
}

function FollowArtistButton({
  performerId,
  isFollowed,
}: {
  performerId: string;
  isFollowed: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();
  const [pending, setPending] = React.useState(false);

  const toggle = React.useCallback(async () => {
    if (pending) return;
    setPending(true);
    void hapticSelection();
    const wasFollowed = isFollowed;
    type DetailCache = { isFollowed?: boolean } | undefined;
    type FollowedCache = { id: string }[] | undefined;
    type ListCache = { id: string; isFollowed?: boolean }[] | undefined;
    const detailKey = ['mobile', 'artist', performerId, 'detail'];
    const followedKey = ['mobile', 'artists', 'followed'];
    const listKey = ['mobile', 'artists', 'list'];
    try {
      await runOptimisticMutation({
        mutation: wasFollowed ? 'performers.unfollow' : 'performers.follow',
        input: { performerId },
        outbox: getCacheOutbox(),
        call: (input) =>
          wasFollowed
            ? utils.client.performers.unfollow.mutate(input)
            : utils.client.performers.follow.mutate(input),
        optimistic: {
          snapshot: () => ({
            detail: queryClient.getQueryData<DetailCache>(detailKey),
            followed: queryClient.getQueryData<FollowedCache>(followedKey),
            list: queryClient.getQueryData<ListCache>(listKey),
          }),
          apply: () => {
            queryClient.setQueryData<DetailCache>(detailKey, (prev) =>
              prev ? { ...prev, isFollowed: !wasFollowed } : prev,
            );
            queryClient.setQueryData<FollowedCache>(followedKey, (prev) => {
              const list = prev ?? [];
              if (wasFollowed) return list.filter((p) => p.id !== performerId);
              if (list.some((p) => p.id === performerId)) return list;
              return [...list, { id: performerId }];
            });
            queryClient.setQueryData<ListCache>(listKey, (prev) =>
              prev?.map((p) =>
                p.id === performerId ? { ...p, isFollowed: !wasFollowed } : p,
              ),
            );
          },
          rollback: (snap) => {
            queryClient.setQueryData(detailKey, snap.detail);
            queryClient.setQueryData(followedKey, snap.followed);
            queryClient.setQueryData(listKey, snap.list);
          },
        },
        reconcile: () => {
          void utils.performers.detail.invalidate({ performerId });
          void utils.performers.followed.invalidate();
          void utils.performers.list.invalidate();
        },
      });
    } catch {
      showToast({
        kind: 'info',
        text: wasFollowed
          ? "We'll unfollow when you're back online."
          : "We'll follow when you're back online.",
      });
    } finally {
      setPending(false);
    }
  }, [pending, isFollowed, performerId, utils, queryClient, showToast]);

  return (
    <Pressable
      onPress={() => {
        void toggle();
      }}
      accessibilityRole="button"
      accessibilityLabel={isFollowed ? 'Unfollow artist' : 'Follow artist'}
      testID="artist-follow-button"
      disabled={pending}
      style={({ pressed }) => [
        styles.followButton,
        {
          backgroundColor: isFollowed ? colors.surface : colors.accent,
          borderColor: isFollowed ? colors.rule : colors.accent,
          opacity: pending || pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.followLabel,
          { color: isFollowed ? colors.ink : colors.accentText },
        ]}
      >
        {isFollowed ? 'FOLLOWING' : 'FOLLOW'}
      </Text>
    </Pressable>
  );
}

function YourShows({
  shows,
  loading,
}: {
  shows: UserShow[];
  loading: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <Section title="Your shows" icon={<Music size={13} color={colors.ink} strokeWidth={2} />}>
      {loading && shows.length === 0 ? (
        <View style={[styles.stubCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : shows.length === 0 ? (
        <View style={[styles.stubCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
          <EmptyState
            icon={<Music size={32} color={colors.faint} strokeWidth={1.5} />}
            title="No shows yet"
            subtitle="When you log a show with this artist on the lineup, it'll appear here."
          />
        </View>
      ) : (
        <View style={styles.showsList}>
          {shows.map((s) => (
            <Link key={s.id} href={`/show/${s.id}`} asChild>
              <ShowCard show={toShowCard(s)} />
            </Link>
          ))}
        </View>
      )}
    </Section>
  );
}

function TaggedPhotos({
  items,
  loading,
}: {
  items: TaggedMedia[];
  loading: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const gridItems: MediaGridItem[] = items.map((m) => {
    const urls = m.urls ?? {};
    const thumbnailUri =
      urls.thumb ?? urls.large ?? urls.source ?? Object.values(urls)[0] ?? '';
    return {
      id: m.id,
      thumbnailUri,
      caption: m.caption,
      tagCount: m.performerIds?.length ?? 0,
    };
  });

  // The grid hands a per-item showId to the lightbox via onItemPress;
  // since this list spans multiple shows, we route to the lightbox with
  // the item's own showId so the swipe pager loads its sibling list.
  const onItemPress = (item: MediaGridItem): void => {
    const source = items.find((m) => m.id === item.id);
    if (!source) return;
    // expo-router doesn't support showId as a query param in the file
    // path here, but `/media/[id]` accepts a showId query string.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router } = require('expo-router') as { router: { push: (h: string) => void } };
    router.push(`/media/${item.id}?showId=${encodeURIComponent(source.showId)}`);
  };

  return (
    <Section title="Tagged photos" icon={<ImageIcon size={13} color={colors.ink} strokeWidth={2} />}>
      {loading && items.length === 0 ? (
        <View style={[styles.stubCard, { backgroundColor: colors.surface, borderColor: colors.rule, padding: 24 }]}>
          <EmptyState
            icon={<ImageIcon size={32} color={colors.faint} strokeWidth={1.5} />}
            title="Loading…"
            subtitle="Pulling in tagged media."
          />
        </View>
      ) : (
        <MediaGrid
          items={gridItems}
          showId={items[0]?.showId ?? ''}
          canUpload={false}
          loading={loading}
          onItemPress={onItemPress}
        />
      )}
    </Section>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={[styles.sectionTitle, { color: colors.ink }]}>{title.toUpperCase()}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 48,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroWrap: {
    paddingBottom: 22,
  },
  heroBanner: {
    borderRadius: 0,
  },
  heroBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
    alignItems: 'flex-start',
    gap: 10,
  },
  heroTitle: {
    fontFamily: 'Fraunces',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.6,
  },
  heroSummary: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  heroActions: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  followButton: {
    paddingVertical: 9,
    paddingHorizontal: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
  },
  followLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  spotifyButton: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  spotifyLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 11 * 0.08,
    textTransform: 'uppercase',
  },
  showsList: {
    gap: 8,
  },
  stubCard: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
