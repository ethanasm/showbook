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
  Image,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Link } from 'expo-router';
import { ChevronLeft, AlertCircle, Image as ImageIcon, Music } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { ShowCard, type ShowCardShow } from '../../components/ShowCard';
import { useTheme, type Kind, type ShowState } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { trpc } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';

interface PerformerDetail {
  id: string;
  name: string;
  imageUrl: string | null;
  isFollowed: boolean;
  showCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

interface UserShowVenue {
  name: string;
  city: string | null;
}

interface UserShowPerformer {
  role: 'headliner' | 'support' | 'cast';
  sortOrder: number;
  performer: { id: string; name: string };
}

interface UserShow {
  id: string;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival' | 'sports';
  state: 'past' | 'ticketed' | 'watching';
  date: string | null;
  productionName: string | null;
  seat: string | null;
  pricePaid: string | null;
  venue: UserShowVenue;
  showPerformers: UserShowPerformer[];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function toShowCard(s: UserShow): ShowCardShow {
  let month = '—';
  let day = '—';
  let dow = '—';
  if (s.date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.date);
    if (m) {
      const monthIdx = Number(m[2]) - 1;
      const d = new Date(Number(m[1]), monthIdx, Number(m[3]));
      month = MONTHS[monthIdx] ?? '—';
      day = String(Number(m[3]));
      dow = DOWS[d.getDay()] ?? '—';
    }
  }
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
    venue: s.venue.name,
    city: s.venue.city,
    month,
    day,
    dow,
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
    queryFn: () =>
      utils.client.performers.detail.query({ performerId }) as unknown as Promise<PerformerDetail>,
    enabled: Boolean(token) && performerId.length > 0,
  });

  const showsQuery = useCachedQuery<UserShow[]>({
    queryKey: ['mobile', 'artist', performerId, 'shows'],
    queryFn: () =>
      utils.client.performers.userShows.query({ performerId }) as unknown as Promise<UserShow[]>,
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title={performer?.name ?? 'Artist'}
        eyebrow={performer?.isFollowed ? 'FOLLOWING' : 'ARTIST'}
        leading={back}
      />

      {detailQuery.isLoading && !performer ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : detailQuery.isError && !performer ? (
        <View style={styles.center}>
          <EmptyState
            icon={<AlertCircle size={40} color={colors.faint} strokeWidth={1.5} />}
            title="Couldn't load artist"
            subtitle={detailQuery.error?.message ?? 'Try again in a moment.'}
            cta={{ label: 'Retry', onPress: () => void detailQuery.refetch() }}
          />
        </View>
      ) : performer ? (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Hero performer={performer} />
          <YourShows shows={shows} loading={showsQuery.isLoading} />
          <PhotosStub />
        </ScrollView>
      ) : null}
    </View>
  );
}

function Hero({ performer }: { performer: PerformerDetail }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const initial = performer.name.trim()[0]?.toUpperCase() ?? '?';
  const range = formatRangeLabel(performer);
  const summary = [
    performer.showCount > 0
      ? `${performer.showCount} show${performer.showCount === 1 ? '' : 's'}`
      : null,
    range,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.heroWrap}>
      <View
        style={[
          styles.heroAvatar,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
        ]}
      >
        {performer.imageUrl ? (
          <Image source={{ uri: performer.imageUrl }} style={styles.heroAvatarImage} />
        ) : (
          <Text style={[styles.heroInitial, { color: colors.muted }]}>{initial}</Text>
        )}
      </View>
      <Text style={[styles.heroTitle, { color: colors.ink }]} numberOfLines={2}>
        {performer.name}
      </Text>
      {summary ? <Text style={[styles.heroSummary, { color: colors.muted }]}>{summary}</Text> : null}
    </View>
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

function PhotosStub(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  // TODO(M4): when MediaGrid lands, render tagged photos for this performer.
  return (
    <Section title="Tagged photos" icon={<ImageIcon size={13} color={colors.ink} strokeWidth={2} />}>
      <View style={[styles.stubCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
        <EmptyState
          icon={<ImageIcon size={32} color={colors.faint} strokeWidth={1.5} />}
          title="Photos arrive in M4"
          subtitle="Tagged media land in the next milestone."
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
  heroAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarImage: {
    width: 96,
    height: 96,
  },
  heroInitial: {
    fontFamily: 'Geist Sans',
    fontSize: 36,
    fontWeight: '700',
  },
  heroTitle: {
    fontFamily: 'Georgia',
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 32,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  heroSummary: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
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
  showsList: {
    gap: 8,
  },
  stubCard: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
