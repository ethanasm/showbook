/**
 * Venue detail.
 *
 * Sections:
 *   - Hero: photo (or placeholder), name, location, follow status + counts
 *   - Upcoming announcements: list of upcoming announcements at the venue
 *   - Your shows: ShowCards for the user's shows at this venue
 *   - Tagged photos: M4 stub
 *
 * Data: `venues.detail` for the header, `venues.upcomingAnnouncements` for
 * the upcoming rail, `venues.userShows` for the user's own shows. All run
 * through `useCachedQuery`.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Link } from 'expo-router';
import {
  ChevronLeft,
  AlertCircle,
  MapPin,
  Calendar,
  Music,
  Image as ImageIcon,
  BookmarkCheck,
  BookmarkPlus,
  Ticket,
} from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { Eyebrow, GradientEmphasis, RemoteImage } from '../../components/design-system';
import { QueryBoundary } from '../../components/QueryBoundary';
import { KindBadge } from '../../components/KindBadge';
import { ShowCard, type ShowCardShow } from '../../components/ShowCard';
import { MediaGrid, type MediaGridItem } from '../../components/MediaGrid';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { useTheme, type Kind, type ShowState } from '../../lib/theme';
import { hapticSelection } from '../../lib/haptics';
import { isNonWatchableKind } from '@showbook/shared';
import { useAuth } from '../../lib/auth';
import { trpc, type RouterOutput } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';
import { useQueryClient } from '@tanstack/react-query';
import { runOptimisticMutation } from '../../lib/mutations';
import { getCacheOutbox } from '../../lib/cache/db';
import { useFeedback } from '../../lib/feedback';
import {
  WATCHED_IDS_CACHE_KEY,
  useToggleWatch,
  type WatchToggle,
} from '../../lib/discover-watch';
import { venueImageSource } from '../../lib/images';

// Derive screen types from the tRPC vanilla client so drift in the server
// contract is caught at the call site instead of papered over with casts.
type UtilsClient = ReturnType<typeof trpc.useUtils>['client'];
type VenueDetail = RouterOutput<UtilsClient['venues']['detail']['query']>;
type UpcomingAnnouncement = RouterOutput<
  UtilsClient['venues']['upcomingAnnouncements']['query']
>[number];
type VenueShow = RouterOutput<UtilsClient['venues']['userShows']['query']>[number];
type VenueMedia = RouterOutput<UtilsClient['media']['listForVenue']['query']>[number];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function parseDate(iso: string): { month: string; day: string; dow: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return { month: '—', day: '—', dow: '—' };
  const y = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, monthIdx, d);
  return {
    month: MONTHS[monthIdx] ?? '—',
    day: String(d),
    dow: DOWS[dt.getDay()] ?? '—',
  };
}

function toShowCard(s: VenueShow, venueName: string, venueCity: string | null): ShowCardShow {
  const date = s.date ? parseDate(s.date) : { month: '—', day: '—', dow: '—' };
  const headliner =
    s.showPerformers.find((sp) => sp.role === 'headliner')?.performer.name ??
    s.productionName ??
    s.showPerformers[0]?.performer.name ??
    'Untitled show';
  const kind: Kind = isNonWatchableKind(s.kind) ? 'concert' : (s.kind as Kind);
  return {
    id: s.id,
    kind,
    state: s.state as ShowState,
    headliner,
    venue: venueName,
    city: venueCity,
    month: date.month,
    day: date.day,
    dow: date.dow,
    seat: s.seat,
    price: s.pricePaid,
    ticketUrl: s.ticketUrl,
  };
}

export default function VenueDetailScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const venueId = typeof params.id === 'string' ? params.id : '';
  const { token } = useAuth();
  const utils = trpc.useUtils();

  const detailQuery = useCachedQuery<VenueDetail>({
    queryKey: ['mobile', 'venue', venueId, 'detail'],
    queryFn: () => utils.client.venues.detail.query({ venueId }),
    enabled: Boolean(token) && venueId.length > 0,
  });

  const upcomingQuery = useCachedQuery<UpcomingAnnouncement[]>({
    queryKey: ['mobile', 'venue', venueId, 'upcoming'],
    queryFn: () =>
      utils.client.venues.upcomingAnnouncements.query({ venueId, limit: 25 }),
    enabled: Boolean(token) && venueId.length > 0,
  });

  const showsQuery = useCachedQuery<VenueShow[]>({
    queryKey: ['mobile', 'venue', venueId, 'shows'],
    queryFn: () => utils.client.venues.userShows.query({ venueId }),
    enabled: Boolean(token) && venueId.length > 0,
  });

  const mediaQuery = useCachedQuery<VenueMedia[]>({
    queryKey: ['mobile', 'venue', venueId, 'media'],
    queryFn: () => utils.client.media.listForVenue.query({ venueId }),
    enabled: Boolean(token) && venueId.length > 0,
  });

  // Watched-event id set drives the per-row "Watching" indicator AND
  // filters watched rows out of the Upcoming list — once the user
  // follows an event it should move down to Your Shows on the same
  // screen instead of staying in two places at once.
  const watchedQuery = useCachedQuery<readonly string[]>({
    queryKey: [...WATCHED_IDS_CACHE_KEY],
    queryFn: () => utils.client.discover.watchedAnnouncementIds.query(),
    enabled: Boolean(token),
  });
  const watchedSet = React.useMemo(
    () => new Set(watchedQuery.data ?? []),
    [watchedQuery.data],
  );

  const onToggleWatch = useToggleWatch({
    onReconcile: () => {
      void utils.venues.detail.invalidate({ venueId });
      void utils.venues.userShows.invalidate({ venueId });
      void utils.venues.upcomingAnnouncements.invalidate({ venueId });
    },
  });

  const back = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/venues'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  const venue = detailQuery.data;
  const upcoming = upcomingQuery.data ?? [];
  const shows = showsQuery.data ?? [];
  const refreshControl = useThemedRefreshControl(
    (detailQuery.isFetching ||
      upcomingQuery.isFetching ||
      showsQuery.isFetching ||
      mediaQuery.isFetching) &&
      !(
        detailQuery.isLoading &&
        upcomingQuery.isLoading &&
        showsQuery.isLoading &&
        mediaQuery.isLoading
      ),
    () => {
      void Promise.all([
        detailQuery.refetch(),
        upcomingQuery.refetch(),
        showsQuery.refetch(),
        mediaQuery.refetch(),
      ]);
    },
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title={venue?.name ?? 'Venue'}
        eyebrow={venue?.isFollowed ? 'FOLLOWING' : 'VENUE'}
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
              title="Couldn't load venue"
              subtitle={
                (err as { message?: string } | null)?.message ?? 'Try again in a moment.'
              }
              cta={{ label: 'Retry', onPress: retry }}
            />
          </View>
        )}
      >
        {(venue) => (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={refreshControl}
          >
            <Hero venue={venue} venueId={venueId} />
            <Upcoming
              items={upcoming.filter((a) => !watchedSet.has(a.id))}
              loading={upcomingQuery.isLoading}
              watchedSet={watchedSet}
              onToggleWatch={onToggleWatch}
            />
            <YourShows
              shows={shows}
              loading={showsQuery.isLoading}
              venueName={venue.name}
              venueCity={venue.city}
            />
            <VenuePhotos
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
  venue,
  venueId,
}: {
  venue: VenueDetail;
  venueId: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { token } = useAuth();
  const source = venueImageSource(venue, token);
  const location = [venue.city, venue.stateRegion, venue.country]
    .filter((p): p is string => Boolean(p))
    .join(', ');
  const summary = [
    venue.userShowCount > 0
      ? `${venue.userShowCount} show${venue.userShowCount === 1 ? '' : 's'}`
      : null,
    venue.upcomingCount > 0 ? `${venue.upcomingCount} upcoming` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Gradient-emphasis the last word of the venue name (matches the
  // artist detail treatment).
  const parts = venue.name.trim().split(/\s+/);
  const head = parts.length > 1 ? parts.slice(0, -1).join(' ') + ' ' : '';
  const tail = parts.length > 1 ? (parts[parts.length - 1] as string) : venue.name;

  return (
    <View style={styles.heroWrap}>
      <RemoteImage
        uri={source?.uri}
        headers={source?.headers}
        name={venue.name}
        kind="concert"
        size="hero"
        aspect="16/9"
        style={styles.heroPhoto}
        accessibilityLabel={`${venue.name} venue photo`}
      />
      <View style={styles.heroBody}>
        <Eyebrow>{venue.isFollowed ? 'FOLLOWING · VENUE' : 'VENUE'}</Eyebrow>
        <Text style={[styles.heroTitle, { color: colors.ink }]} numberOfLines={2}>
          {head ? <Text>{head}</Text> : null}
          <GradientEmphasis style={[styles.heroTitle, { color: colors.accent }]}>
            {tail}
          </GradientEmphasis>
        </Text>
        {location ? (
          <View style={styles.heroLocation}>
            <MapPin size={13} color={colors.muted} strokeWidth={2} />
            <Text style={[styles.heroLocationText, { color: colors.muted }]}>{location}</Text>
          </View>
        ) : null}
        {summary ? <Text style={[styles.heroSummary, { color: colors.muted }]}>{summary}</Text> : null}
        <FollowVenueButton venueId={venueId} isFollowed={venue.isFollowed} />
      </View>
    </View>
  );
}

function FollowVenueButton({
  venueId,
  isFollowed,
}: {
  venueId: string;
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
    const detailKey = ['mobile', 'venue', venueId, 'detail'];
    const followedKey = ['mobile', 'venues', 'followed'];
    const listKey = ['mobile', 'venues', 'list'];
    try {
      await runOptimisticMutation({
        mutation: wasFollowed ? 'venues.unfollow' : 'venues.follow',
        input: { venueId },
        outbox: getCacheOutbox(),
        call: (input) =>
          wasFollowed
            ? utils.client.venues.unfollow.mutate(input)
            : utils.client.venues.follow.mutate(input),
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
              if (wasFollowed) return list.filter((v) => v.id !== venueId);
              if (list.some((v) => v.id === venueId)) return list;
              return [...list, { id: venueId }];
            });
            queryClient.setQueryData<ListCache>(listKey, (prev) =>
              prev?.map((v) =>
                v.id === venueId ? { ...v, isFollowed: !wasFollowed } : v,
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
          void utils.venues.detail.invalidate({ venueId });
          void utils.venues.followed.invalidate();
          void utils.venues.list.invalidate();
        },
      });
    } catch {
      // The outbox now owns the row; the offline-sync provider polls and
      // surfaces it in the drawer. A toast keeps the user informed without
      // alarming them — the change isn't lost.
      showToast({
        kind: 'info',
        text: wasFollowed
          ? "We'll unfollow when you're back online."
          : "We'll follow when you're back online.",
      });
    } finally {
      setPending(false);
    }
  }, [pending, isFollowed, venueId, utils, queryClient, showToast]);

  return (
    <Pressable
      onPress={() => {
        void toggle();
      }}
      accessibilityRole="button"
      accessibilityLabel={isFollowed ? 'Unfollow venue' : 'Follow venue'}
      testID="venue-follow-button"
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

function Upcoming({
  items,
  loading,
  watchedSet,
  onToggleWatch,
}: {
  items: UpcomingAnnouncement[];
  loading: boolean;
  watchedSet: Set<string>;
  onToggleWatch: WatchToggle;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <Section title="Upcoming" icon={<Calendar size={13} color={colors.ink} strokeWidth={2} />}>
      {loading && items.length === 0 ? (
        <View style={[styles.stubCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : items.length === 0 ? (
        <View style={[styles.stubCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
          <EmptyState
            icon={<Calendar size={32} color={colors.faint} strokeWidth={1.5} />}
            title="Nothing on sale"
            subtitle="No upcoming announcements at this venue right now."
          />
        </View>
      ) : (
        <View style={styles.upcomingList}>
          {items.map((a) => (
            <UpcomingRow
              key={a.id}
              item={a}
              isWatching={watchedSet.has(a.id)}
              onToggleWatch={onToggleWatch}
            />
          ))}
        </View>
      )}
    </Section>
  );
}

function UpcomingRow({
  item,
  isWatching,
  onToggleWatch,
}: {
  item: UpcomingAnnouncement;
  isWatching: boolean;
  onToggleWatch: WatchToggle;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { showToast } = useFeedback();
  const { month, day, dow } = parseDate(item.showDate);
  const accent = tokens.kindColor(item.kind);
  const title = item.productionName ?? item.headliner;
  const canWatch = !isNonWatchableKind(item.kind);
  // The `venues.upcomingAnnouncements` procedure returns raw rows and
  // doesn't synthesize a Ticketmaster URL from `sourceEventId` the way
  // `discover.followedFeed` does — fall back here so the Ticket icon
  // appears whenever we have any way to deep-link.
  const ticketUrl =
    item.ticketUrl ??
    (item.sourceEventId
      ? `https://www.ticketmaster.com/event/${item.sourceEventId}`
      : null);

  return (
    <View
      style={[
        styles.upcomingRow,
        { backgroundColor: colors.surface, borderLeftColor: accent },
      ]}
    >
      <View style={styles.upcomingDate}>
        <Text style={[styles.upcomingMonth, { color: colors.muted }]}>{month}</Text>
        <Text style={[styles.upcomingDay, { color: colors.ink }]}>{day}</Text>
        <Text style={[styles.upcomingDow, { color: colors.faint }]}>{dow}</Text>
      </View>
      <View style={styles.upcomingContent}>
        <View style={styles.upcomingBadgeRow}>
          <KindBadge kind={item.kind} size="sm" />
        </View>
        <Text
          style={[styles.upcomingTitle, { color: colors.ink }]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {title}
        </Text>
      </View>
      {(canWatch || ticketUrl) && (
        <View style={styles.upcomingActions}>
          {canWatch && (
            <RowIconAction
              onPress={() => {
                void hapticSelection();
                void onToggleWatch(item.id, isWatching);
              }}
              accessibilityLabel={
                isWatching ? 'Stop watching this event' : 'Watch this event'
              }
              testID={`venue-upcoming-watch-${item.id}`}
              active={isWatching}
              accent={accent}
              colors={colors}
            >
              {isWatching ? (
                <BookmarkCheck size={14} color={accent} strokeWidth={2} />
              ) : (
                <BookmarkPlus size={14} color={colors.muted} strokeWidth={2} />
              )}
            </RowIconAction>
          )}
          {ticketUrl && (
            <RowIconAction
              onPress={() => {
                void hapticSelection();
                Linking.openURL(ticketUrl).catch(() => {
                  showToast({
                    kind: 'error',
                    text: "Couldn't open Ticketmaster.",
                  });
                });
              }}
              accessibilityLabel="Open tickets on Ticketmaster"
              testID={`venue-upcoming-tickets-${item.id}`}
              colors={colors}
            >
              <Ticket size={14} color={colors.muted} strokeWidth={2} />
            </RowIconAction>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Small pill-shaped icon button used by the Upcoming row. Matches the
 * Discover tab's row actions so the affordance stays consistent across
 * the two surfaces.
 */
function RowIconAction({
  onPress,
  accessibilityLabel,
  testID,
  active,
  accent,
  colors,
  children,
}: {
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
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [
        styles.upcomingIconAction,
        {
          backgroundColor: active && accent ? `${accent}1f` : colors.surface,
          borderColor: active && accent ? `${accent}55` : colors.rule,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

function YourShows({
  shows,
  loading,
  venueName,
  venueCity,
}: {
  shows: VenueShow[];
  loading: boolean;
  venueName: string;
  venueCity: string | null;
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
            title="Haven't been here yet"
            subtitle="Log a show at this venue and it'll appear here."
          />
        </View>
      ) : (
        <View style={styles.showsList}>
          {shows.map((s) => (
            <Link key={s.id} href={`/show/${s.id}`} asChild>
              <ShowCard show={toShowCard(s, venueName, venueCity)} />
            </Link>
          ))}
        </View>
      )}
    </Section>
  );
}

interface VenueMediaItem {
  id: string;
  showId: string;
  caption: string | null;
  performerIds: string[];
  urls: Record<string, string>;
}

function VenuePhotos({
  items,
  loading,
}: {
  items: VenueMediaItem[];
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

  const onItemPress = (item: MediaGridItem): void => {
    const source = items.find((m) => m.id === item.id);
    if (!source) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router: r } = require('expo-router') as { router: { push: (h: string) => void } };
    r.push(`/media/${item.id}?showId=${encodeURIComponent(source.showId)}`);
  };

  return (
    <Section title="Photos" icon={<ImageIcon size={13} color={colors.ink} strokeWidth={2} />}>
      {loading && items.length === 0 ? (
        <View
          style={[
            styles.stubCard,
            { backgroundColor: colors.surface, borderColor: colors.rule, padding: 24 },
          ]}
        >
          <EmptyState
            icon={<ImageIcon size={32} color={colors.faint} strokeWidth={1.5} />}
            title="Loading…"
            subtitle="Pulling in media from your shows here."
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
  heroPhoto: {
    borderRadius: 0,
  },
  heroBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
    alignItems: 'flex-start',
    gap: 10,
  },
  heroTitle: {
    fontFamily: 'Georgia',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.6,
  },
  heroLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroLocationText: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '400',
  },
  heroSummary: {
    fontFamily: 'Geist Sans',
    fontSize: 12.5,
    fontWeight: '400',
    lineHeight: 18,
  },
  followButton: {
    marginTop: 4,
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
  upcomingList: {
    gap: 8,
  },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 12,
    paddingRight: 12,
    borderRadius: 12,
    borderLeftWidth: 3,
    gap: 12,
  },
  upcomingDate: {
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 12,
  },
  upcomingMonth: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
    textTransform: 'uppercase',
  },
  upcomingDay: {
    fontFamily: 'Geist Sans',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
  },
  upcomingDow: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '400',
    textTransform: 'uppercase',
  },
  upcomingContent: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 4,
  },
  upcomingBadgeRow: {
    flexDirection: 'row',
  },
  upcomingTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 19,
  },
  upcomingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
  },
  upcomingIconAction: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  showsList: {
    gap: 8,
  },
  stubCard: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
