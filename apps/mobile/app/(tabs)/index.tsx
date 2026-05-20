/**
 * Home tab — M2.B real implementation.
 *
 * Composition (per `docs/specs/mobile-cloud-claude-prompts.md` C-1):
 *   - HERO — the next ticketed show (or today's, when one exists) gets
 *     a full-bleed image treatment via `HeroShowCard`
 *   - UPCOMING — the remaining ticketed shows after the hero
 *   - RECENTLY ADDED — last 3 past shows by date
 *   - WISHLIST — top 3 watching shows (by `createdAt`)
 *
 * The greeting + at-a-glance stats live in `HomeHeader`, which
 * replaces the generic `TopBar` for this screen so the personalised
 * "Good morning, Ethan · 3 on deck" line can sit above the title.
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
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { Calendar } from 'lucide-react-native';
import { HomeHeader } from '../../components/HomeHeader';
import { MeTopBarAction } from '../../components/MeTopBarAction';
import { EmptyState } from '../../components/EmptyState';
import { GetStartedHub } from '../../components/GetStartedHub';
import { ShowCard, type ShowCardShow } from '../../components/ShowCard';
import { HeroShowCard } from '../../components/HeroShowCard';
import { ShowCardListSkeleton } from '../../components/skeletons';
import { ShowActionSheet } from '../../components/ShowActionSheet';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { useTheme, type Kind, type ShowState } from '../../lib/theme';
import { isNonWatchableKind } from '@showbook/shared';
import { useAuth } from '../../lib/auth';
import { trpc } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';
import { venueImageSource } from '../../lib/images';

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
  let year = '';
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
      year = String(y);
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
  const avatarUrl = headlinerSp?.performer.imageUrl ?? firstSp?.performer.imageUrl ?? null;

  // Non-watchable kinds (sports / film / unknown) shouldn't reach the
  // user's saved shows in normal flow — the discover.watch guard rejects
  // them — but if legacy data exists, fall back to 'concert' visually.
  const kind: Kind = isNonWatchableKind(row.kind) ? 'concert' : (row.kind as Kind);

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
    year,
    seat: row.seat ?? null,
    price: row.pricePaid ?? null,
    avatarUrl,
  };
}

/**
 * Resolve the hero image for a show. Headliner photos are absolute URLs
 * (TM / Spotify) so they load directly. Venue photos may be Google
 * Places resource names that have to go through `/api/venue-photo/<id>`
 * with the user's Bearer token attached — `venueImageSource` returns
 * the `{ uri, headers? }` pair for that case.
 */
function heroImageSource(
  row: ShowsListItem,
  token: string | null,
): { uri: string; headers?: Record<string, string> } | null {
  const headlinerSp = [...row.showPerformers]
    .filter((sp) => sp.role === 'headliner')
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const firstSp = [...row.showPerformers].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const performerImage = headlinerSp?.performer.imageUrl ?? firstSp?.performer.imageUrl;
  if (performerImage) {
    return { uri: performerImage };
  }
  return venueImageSource(row.venue, token);
}

function countThisYear(rows: readonly ShowsListItem[], year: number): number {
  let n = 0;
  for (const r of rows) {
    if (r.state !== 'past') continue;
    if (!r.date) continue;
    const y = Number(r.date.slice(0, 4));
    if (y === year) n += 1;
  }
  return n;
}

function countOnDeck(
  rows: readonly ShowsListItem[],
  todayYmd: string,
): number {
  let n = 0;
  for (const r of rows) {
    if (r.state !== 'ticketed' && r.state !== 'watching') continue;
    if (!r.date) continue;
    if (r.date >= todayYmd) n += 1;
  }
  return n;
}

export default function HomeScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const utils = trpc.useUtils();
  const router = useRouter();
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

    const upcomingAll = rows
      .filter(
        (r) =>
          r.state === 'ticketed' &&
          r.date !== null &&
          r.date > today &&
          r.id !== nowPlaying?.id,
      )
      .sort((a, b) => (a.date! < b.date! ? -1 : 1));

    // The hero promotes the first ticketed show on deck (or today's, if
    // there is one) into a full-bleed treatment. Everything else in the
    // upcoming bucket renders as rows beneath it.
    const hero = nowPlaying ?? upcomingAll[0] ?? null;
    const upcomingRest = hero === nowPlaying ? upcomingAll.slice(0, 3) : upcomingAll.slice(1, 4);

    const recent = rows
      .filter((r) => r.state === 'past' && r.date !== null)
      .sort((a, b) => (a.date! < b.date! ? 1 : -1))
      .slice(0, 3);

    const wishlist = rows
      .filter((r) => r.state === 'watching')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 3);

    return {
      hero,
      heroIsToday: hero != null && hero === nowPlaying,
      upcoming: upcomingRest,
      recent,
      wishlist,
      total: rows.length,
    };
  }, [showsQuery.data]);

  const headerCounts = React.useMemo(() => {
    const rows = showsQuery.data ?? [];
    return {
      upcoming: countOnDeck(rows, todayIso()),
      thisYear: countThisYear(rows, new Date().getFullYear()),
    };
  }, [showsQuery.data]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <HomeHeader
        userName={user?.name ?? null}
        upcomingCount={headerCounts.upcoming}
        thisYearCount={headerCounts.thisYear}
        rightAction={<MeTopBarAction />}
      />

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
        ) : showsQuery.isError && !showsQuery.data ? (
          <View style={styles.skeletonWrap}>
            <EmptyState
              title="Couldn't load your shows"
              subtitle={
                showsQuery.error instanceof Error
                  ? showsQuery.error.message
                  : 'Tap to try again.'
              }
              cta={{
                label: 'Try again',
                onPress: () => void showsQuery.refetch(),
              }}
            />
          </View>
        ) : sections.total === 0 ? (
          <GetStartedHub variant="expanded" />
        ) : (
          <>
            {sections.hero ? (
              <Section
                title={sections.heroIsToday ? 'Tonight' : 'Next up'}
                paddingTop={4}
              >
                <View style={styles.heroWrap}>
                  <HeroShowCard
                    show={toShowCardShow(sections.hero)}
                    dateYmd={sections.hero.date}
                    {...(() => {
                      const src = heroImageSource(sections.hero, token);
                      return src
                        ? { imageUrl: src.uri, imageHeaders: src.headers }
                        : {};
                    })()}
                    onPress={() => router.push(`/show/${sections.hero!.id}`)}
                    onLongPress={() =>
                      setActionSheetFor({
                        id: sections.hero!.id,
                        state: sections.hero!.state as ShowState,
                      })
                    }
                  />
                </View>
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
            !sections.hero ? (
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
  paddingTop,
}: {
  title: string;
  children: React.ReactNode;
  /** Override the default section top padding (18). The hero block uses
   * a tighter inset so it sits closer to the greeting block above. */
  paddingTop?: number;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View style={[styles.section, paddingTop !== undefined && { paddingTop }]}>
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
    paddingBottom: 32,
  },
  scrollFlex: {
    flexGrow: 1,
    paddingBottom: 32,
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
  heroWrap: {
    paddingHorizontal: 16,
  },
});
