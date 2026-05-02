/**
 * Home tab — M2.B real implementation.
 *
 * Composition (per `showbook-specs/mobile-cloud-claude-prompts.md` C-1):
 *   - NOW PLAYING — a single ticketed show whose `date` is today
 *   - UPCOMING — next 3 ticketed shows after today
 *   - RECENTLY ADDED — last 3 past shows by date
 *   - WISHLIST — top 3 watching shows (by `createdAt`)
 *
 * Data: a single `shows.list` read goes through `useCachedQuery` so the
 * persistent cache hydration set up in M2.A keeps the screen warm
 * across cold starts. The slice/sort happens client-side because the
 * router currently exposes only `list`. Setlist editing on the
 * now-playing card is M3 — we just show the card metadata here.
 *
 * Each ShowCard links to `/show/[id]`. That route lands in M2.F (C-3);
 * Expo Router warns about a missing route at runtime but does not
 * crash, which is intentional.
 */

import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { Music, Calendar, Compass } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { ShowCard, type ShowCardShow } from '../../components/ShowCard';
import { ShowCardListSkeleton } from '../../components/skeletons';
import { ShowActionSheet } from '../../components/ShowActionSheet';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { useTheme, type Kind, type ShowState } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { trpc } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';

// Derive the per-row shape from the tRPC vanilla client to avoid pulling in
// `@trpc/server` types directly. This stays in lockstep with `shows.list`'s
// actual return type without extra ceremony.
type ShowsListData = Awaited<
  ReturnType<ReturnType<typeof trpc.useUtils>['client']['shows']['list']['query']>
>;
type ShowsListItem = ShowsListData[number];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toShowCardShow(row: ShowsListItem): ShowCardShow {
  // Date can be null for watching-without-date entries; fall back to em-dashes.
  let month = '—';
  let day = '—';
  let dow = '—';
  if (row.date) {
    const [yStr, mStr, dStr] = row.date.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      const local = new Date(y, m - 1, d);
      month = MONTHS[m - 1] ?? '—';
      day = String(d);
      dow = DOWS[local.getDay()] ?? '—';
    }
  }

  // Headliner: prefer productionName for theatre runs, else the
  // headliner role with the lowest sortOrder, else the first performer.
  const headlinerSp = [...row.showPerformers]
    .filter((sp) => sp.role === 'headliner')
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const firstSp = [...row.showPerformers].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const headliner =
    row.productionName ??
    headlinerSp?.performer.name ??
    firstSp?.performer.name ??
    'Untitled show';

  // ShowCardShow's Kind union doesn't include 'sports'; treat it as a
  // concert visually until the design adds a sports accent.
  const kind: Kind = row.kind === 'sports' ? 'concert' : (row.kind as Kind);

  return {
    id: row.id,
    kind,
    state: row.state as ShowState,
    headliner,
    venue: row.venue.name,
    city: row.venue.city ?? null,
    month,
    day,
    dow,
    seat: row.seat ?? null,
    price: row.pricePaid ?? null,
  };
}

export default function HomeScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const utils = trpc.useUtils();
  const [actionSheetFor, setActionSheetFor] = React.useState<{
    id: string;
    state: ShowState;
  } | null>(null);

  const showsQuery = useCachedQuery<ShowsListItem[]>({
    queryKey: ['mobile', 'home', 'shows.list'],
    queryFn: () => utils.client.shows.list.query({}),
    enabled: Boolean(token),
  });

  const refreshControl = useThemedRefreshControl(
    showsQuery.isFetching && !showsQuery.isLoading,
    () => {
      void showsQuery.refetch();
    },
  );

  const sections = React.useMemo(() => {
    const rows = showsQuery.data ?? [];
    const today = todayIso();

    const nowPlaying = rows.find(
      (r) => r.state === 'ticketed' && r.date === today,
    );

    const upcoming = rows
      .filter(
        (r) =>
          r.state === 'ticketed' &&
          r.date !== null &&
          r.date > today &&
          r.id !== nowPlaying?.id,
      )
      .sort((a, b) => (a.date! < b.date! ? -1 : 1))
      .slice(0, 3);

    const recent = rows
      .filter((r) => r.state === 'past' && r.date !== null)
      .sort((a, b) => (a.date! < b.date! ? 1 : -1))
      .slice(0, 3);

    const wishlist = rows
      .filter((r) => r.state === 'watching')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 3);

    return { nowPlaying, upcoming, recent, wishlist, total: rows.length };
  }, [showsQuery.data]);

  const eyebrow = sections.nowPlaying ? 'NOW PLAYING TODAY' : 'YOUR SHOWS';

  const discoverAction = (
    <Pressable
      onPress={() => router.push('/discover')}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Discover"
    >
      <Compass size={20} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Home" eyebrow={eyebrow} rightAction={discoverAction} large />

      <ScrollView
        contentContainerStyle={
          showsQuery.isLoading || sections.total === 0
            ? styles.scrollFlex
            : styles.scrollContent
        }
        refreshControl={refreshControl}
      >
        {showsQuery.isLoading ? (
          <View style={styles.skeletonWrap}>
            <ShowCardListSkeleton count={4} />
          </View>
        ) : sections.total === 0 ? (
          <EmptyState
            icon={<Music size={40} color={colors.faint} strokeWidth={1.5} />}
            title="No shows yet"
            subtitle="Add your first show from the Add tab — concerts, theatre, comedy, festivals."
          />
        ) : (
          <>
            {sections.nowPlaying ? (
              <Section title="Now playing">
                <ShowCardLink
                show={sections.nowPlaying}
                onLongPress={() =>
                  setActionSheetFor({
                    id: sections.nowPlaying!.id,
                    state: sections.nowPlaying!.state as ShowState,
                  })
                }
              />
              </Section>
            ) : null}

            {sections.upcoming.length > 0 ? (
              <Section title="Upcoming">
                {sections.upcoming.map((s) => (
                  <ShowCardLink key={s.id} show={s} onLongPress={() => setActionSheetFor({ id: s.id, state: s.state as ShowState })} />
                ))}
              </Section>
            ) : null}

            {sections.recent.length > 0 ? (
              <Section title="Recently added">
                {sections.recent.map((s) => (
                  <ShowCardLink key={s.id} show={s} onLongPress={() => setActionSheetFor({ id: s.id, state: s.state as ShowState })} />
                ))}
              </Section>
            ) : null}

            {sections.wishlist.length > 0 ? (
              <Section title="Wishlist">
                {sections.wishlist.map((s) => (
                  <ShowCardLink key={s.id} show={s} onLongPress={() => setActionSheetFor({ id: s.id, state: s.state as ShowState })} />
                ))}
              </Section>
            ) : null}

            {sections.upcoming.length === 0 &&
            sections.recent.length === 0 &&
            sections.wishlist.length === 0 &&
            !sections.nowPlaying ? (
              <EmptyState
                icon={<Calendar size={40} color={colors.faint} strokeWidth={1.5} />}
                title="Nothing on deck"
                subtitle="Add a ticket or wishlist a show to see it here."
              />
            ) : null}
          </>
        )}
      </ScrollView>

      {actionSheetFor ? (
        <ShowActionSheet
          open
          onClose={() => setActionSheetFor(null)}
          showId={actionSheetFor.id}
          state={actionSheetFor.state}
        />
      ) : null}
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: tokens.colors.muted }]}>
        {title.toUpperCase()}
      </Text>
      <View style={styles.sectionList}>{children}</View>
    </View>
  );
}

function ShowCardLink({
  show,
  onLongPress,
}: {
  show: ShowsListItem;
  onLongPress: () => void;
}): React.JSX.Element {
  const card = React.useMemo(() => toShowCardShow(show), [show]);
  return (
    <Link href={`/show/${show.id}`} asChild>
      <ShowCard show={card} onLongPress={onLongPress} />
    </Link>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 100,
  },
  scrollFlex: {
    flexGrow: 1,
    paddingBottom: 100,
  },
  skeletonWrap: {
    paddingTop: 12,
    gap: 16,
  },
  section: {
    paddingTop: 18,
  },
  sectionLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  sectionList: {
    paddingHorizontal: 16,
    gap: 8,
  },
});
