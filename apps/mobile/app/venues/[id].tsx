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
  Image,
  StyleSheet,
  ActivityIndicator,
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
  Building2,
} from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { KindBadge } from '../../components/KindBadge';
import { ShowCard, type ShowCardShow } from '../../components/ShowCard';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { useTheme, type Kind, type ShowState } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { trpc } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';

interface VenueDetail {
  id: string;
  name: string;
  city: string | null;
  stateRegion: string | null;
  country: string | null;
  photoUrl: string | null;
  capacity: number | null;
  isFollowed: boolean;
  userShowCount: number;
  upcomingCount: number;
}

interface UpcomingAnnouncement {
  id: string;
  kind: Kind;
  headliner: string;
  productionName: string | null;
  showDate: string;
}

interface VenueShowPerformer {
  role: 'headliner' | 'support' | 'cast';
  sortOrder: number;
  performer: { id: string; name: string };
}

interface VenueShow {
  id: string;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival' | 'sports';
  state: 'past' | 'ticketed' | 'watching';
  date: string | null;
  productionName: string | null;
  seat: string | null;
  pricePaid: string | null;
  showPerformers: VenueShowPerformer[];
}

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
  const kind: Kind = s.kind === 'sports' ? 'concert' : (s.kind as Kind);
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
    queryFn: () =>
      utils.client.venues.detail.query({ venueId }) as unknown as Promise<VenueDetail>,
    enabled: Boolean(token) && venueId.length > 0,
  });

  const upcomingQuery = useCachedQuery<UpcomingAnnouncement[]>({
    queryKey: ['mobile', 'venue', venueId, 'upcoming'],
    queryFn: () =>
      utils.client.venues.upcomingAnnouncements.query({
        venueId,
        limit: 25,
      }) as unknown as Promise<UpcomingAnnouncement[]>,
    enabled: Boolean(token) && venueId.length > 0,
  });

  const showsQuery = useCachedQuery<VenueShow[]>({
    queryKey: ['mobile', 'venue', venueId, 'shows'],
    queryFn: () =>
      utils.client.venues.userShows.query({ venueId }) as unknown as Promise<VenueShow[]>,
    enabled: Boolean(token) && venueId.length > 0,
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
    (detailQuery.isFetching || upcomingQuery.isFetching || showsQuery.isFetching) &&
      !(detailQuery.isLoading && upcomingQuery.isLoading && showsQuery.isLoading),
    () => {
      void Promise.all([
        detailQuery.refetch(),
        upcomingQuery.refetch(),
        showsQuery.refetch(),
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

      {detailQuery.isLoading && !venue ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : detailQuery.isError && !venue ? (
        <View style={styles.center}>
          <EmptyState
            icon={<AlertCircle size={40} color={colors.faint} strokeWidth={1.5} />}
            title="Couldn't load venue"
            subtitle={detailQuery.error?.message ?? 'Try again in a moment.'}
            cta={{ label: 'Retry', onPress: () => void detailQuery.refetch() }}
          />
        </View>
      ) : venue ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        >
          <Hero venue={venue} />
          <Upcoming items={upcoming} loading={upcomingQuery.isLoading} />
          <YourShows
            shows={shows}
            loading={showsQuery.isLoading}
            venueName={venue.name}
            venueCity={venue.city}
          />
          <PhotosStub />
        </ScrollView>
      ) : null}
    </View>
  );
}

function Hero({ venue }: { venue: VenueDetail }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const location = [venue.city, venue.stateRegion, venue.country]
    .filter((p): p is string => Boolean(p))
    .join(', ');
  const summary = [
    venue.userShowCount > 0
      ? `${venue.userShowCount} show${venue.userShowCount === 1 ? '' : 's'}`
      : null,
    venue.upcomingCount > 0 ? `${venue.upcomingCount} upcoming` : null,
    venue.capacity ? `${venue.capacity.toLocaleString()} cap.` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.heroWrap}>
      <View
        style={[
          styles.heroPhoto,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
        ]}
      >
        {venue.photoUrl ? (
          <Image source={{ uri: venue.photoUrl }} style={styles.heroPhotoImage} />
        ) : (
          <Building2 size={48} color={colors.faint} strokeWidth={1.5} />
        )}
      </View>
      <Text style={[styles.heroTitle, { color: colors.ink }]} numberOfLines={2}>
        {venue.name}
      </Text>
      {location ? (
        <View style={styles.heroLocation}>
          <MapPin size={13} color={colors.muted} strokeWidth={2} />
          <Text style={[styles.heroLocationText, { color: colors.muted }]}>{location}</Text>
        </View>
      ) : null}
      {summary ? <Text style={[styles.heroSummary, { color: colors.muted }]}>{summary}</Text> : null}
    </View>
  );
}

function Upcoming({
  items,
  loading,
}: {
  items: UpcomingAnnouncement[];
  loading: boolean;
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
            <UpcomingRow key={a.id} item={a} />
          ))}
        </View>
      )}
    </Section>
  );
}

function UpcomingRow({ item }: { item: UpcomingAnnouncement }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { month, day, dow } = parseDate(item.showDate);
  const accent = tokens.kindColor(item.kind);
  const title = item.productionName ?? item.headliner;

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
    </View>
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

function PhotosStub(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  // TODO(M4): when MediaGrid lands, render media-from-your-shows here.
  return (
    <Section title="Photos" icon={<ImageIcon size={13} color={colors.ink} strokeWidth={2} />}>
      <View style={[styles.stubCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
        <EmptyState
          icon={<ImageIcon size={32} color={colors.faint} strokeWidth={1.5} />}
          title="Photos arrive in M4"
          subtitle="Media from your shows at this venue will appear here."
        />
      </View>
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 22,
    alignItems: 'center',
    gap: 12,
  },
  heroPhoto: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPhotoImage: {
    width: '100%',
    height: 180,
  },
  heroTitle: {
    fontFamily: 'Georgia',
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 32,
    letterSpacing: -0.4,
    textAlign: 'center',
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
  showsList: {
    gap: 8,
  },
  stubCard: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
