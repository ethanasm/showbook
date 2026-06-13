/**
 * Shows tab — Timeline / Calendar / Stats.
 *
 * Three modes share a single `shows.list` query (the procedure already
 * returns the venue + performer object graph we need). Per-mode views
 * derive their data client-side from that one list:
 *
 *   - Timeline: a flat, chronological feed grouped by year. Future shows
 *     first (soonest first), then past (most-recent first). Compact
 *     ShowCards reuse the existing component.
 *   - Calendar: month and year sub-views. Month shows a custom 7×6 grid
 *     (CalendarGrid) plus a side list of events for the selected day or
 *     month. Year shows a 3×4 grid of MiniMonth tiles with per-day event
 *     dots; tapping a tile drills into that month. Hand-rolled — no
 *     calendar lib.
 *   - Stats:    headline counts (shows / spent / venues / artists), a
 *     by-kind mix bar, and top-5 lists for performers and venues. Derived
 *     from the same list — no separate `shows.stats` procedure exists yet.
 *
 * At the tablet breakpoint the screen composes a two-pane split view:
 * the list above becomes a fixed-width sidebar and the selected show's
 * detail renders in place in the right pane (SplitViewLayout). On phone
 * the list fills the screen and rows push /show/[id] as a stack route.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  SectionList,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import * as SecureStore from 'expo-secure-store';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { RADII } from '@/lib/theme-utils';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { MeTopBarAction } from '../../components/MeTopBarAction';
import { KindFilterControl } from '../../components/KindFilterControl';
import { kindFilterNoun, type KindFilterValue } from '../../components/KindFilterMenu';
import { SegmentedControl } from '../../components/SegmentedControl';
import { FilterChipsRow, type FilterGroup } from '../../components/FilterChipsRow';
import { ShowCard, type ShowCardShow } from '../../components/ShowCard';
import { EmptyState } from '../../components/EmptyState';
import { EmptyStateHero } from '../../components/design-system';
import { ShowCardListSkeleton } from '../../components/skeletons';
import {
  CalendarGrid,
  MiniMonth,
  type CalendarEvent,
  type CalendarSpan,
} from '../../components/CalendarGrid';
import { CalendarSwipeHint } from '../../components/CalendarSwipeHint';
import { ShowActionSheet } from '../../components/ShowActionSheet';
import { MarkTicketedSheet } from '../../components/MarkTicketedSheet';
import { SplitViewLayout, useSelectedShow } from '../../components/SplitViewLayout';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { useTheme, type Kind, type ShowState } from '@/lib/theme';
import { useBreakpoint } from '@/lib/responsive';
import ShowDetailScreen from '../show/[id]';
import { trpc } from '@/lib/trpc';
import { useCachedQuery } from '@/lib/cache';
import { useAuth } from '@/lib/auth';
import { headlinerDisplayName } from '@/lib/show-display';
import { showCoverImageSource } from '@/lib/images';
import {
  atMaxCursor,
  atMinCursor,
  computeMonthBounds,
  stepCursor,
} from '@/lib/calendarBounds';
import { effectiveShowState, matchesSearchQuery } from '@showbook/shared';
import { SearchBar } from '../../components/SearchBar';

type Mode = 'timeline' | 'calendar' | 'stats';
type CalendarMode = 'month' | 'year';

const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface ShowRow {
  id: string;
  kind: Kind;
  state: ShowState;
  date: string | null;
  endDate: string | null;
  seat: string | null;
  pricePaid: string | null;
  productionName: string | null;
  coverImageUrl: string | null;
  ticketUrl: string | null;
  venue: { id: string; name: string; city: string | null };
  performers: {
    id: string;
    name: string;
    role: 'headliner' | 'support' | 'cast';
    sortOrder: number;
    imageUrl: string | null;
  }[];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function headlinerOf(row: ShowRow): string {
  return headlinerDisplayName({
    kind: row.kind,
    productionName: row.productionName,
    performers: row.performers,
    fallback: 'Untitled show',
  });
}

function priceCents(row: ShowRow): number {
  if (!row.pricePaid) return 0;
  const n = Number(row.pricePaid);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Parse a YYYY-MM-DD date string as a local-time Date. Avoid `new Date(s)`
 * directly because it parses as UTC and then shifts back in en-US timezones,
 * which would render the day-before in the timeline.
 */
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function headlinerAvatarOf(row: ShowRow): string | null {
  // Festivals shouldn't borrow a lineup member's face — let the
  // ShowCard avatar fall through to the kind-coloured monogram.
  if (row.kind === 'festival') {
    return null;
  }
  const headlinerSp = [...row.performers]
    .filter((p) => p.role === 'headliner')
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const firstSp = [...row.performers].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return headlinerSp?.imageUrl ?? firstSp?.imageUrl ?? null;
}

function toShowCard(row: ShowRow, token: string | null): ShowCardShow {
  const headliner = headlinerOf(row);
  // Production shows (theatre + festival w/ productionName) prefer the
  // TM-sourced cover image when the daily backfill or first-view
  // lazy-resolve has populated it. When the row's `coverImageUrl` is
  // still null the helper returns null and the avatar falls through to
  // the legacy performer photo / monogram — same UX as before.
  // Inline the production-label predicate to avoid hauling in a
  // `ShowLike`-shaped object (this row uses `performers`, not `showPerformers`).
  const isProductionLabeled =
    (row.kind === 'theatre' || row.kind === 'festival') &&
    Boolean(row.productionName);
  const coverSource = isProductionLabeled
    ? showCoverImageSource({ id: row.id, coverImageUrl: row.coverImageUrl }, token)
    : null;
  const avatarUrl = coverSource?.uri ?? headlinerAvatarOf(row);
  const avatarHeaders = coverSource?.headers;
  if (row.date) {
    const d = parseLocalDate(row.date);
    return {
      id: row.id,
      kind: row.kind,
      state: row.state,
      headliner,
      venue: row.venue.name,
      city: row.venue.city,
      month: MONTH_SHORT[d.getMonth()],
      day: String(d.getDate()),
      dow: DOW_SHORT[d.getDay()],
      // Shows tab provides year context via the sticky section header
      // (timeline view) and the cursor-year header (month view), so we
      // skip the per-row year to avoid redundant chrome.
      year: '',
      seat: row.seat,
      price: row.pricePaid ? `$${row.pricePaid}` : null,
      avatarUrl,
      avatarHeaders,
      ticketUrl: row.ticketUrl,
    };
  }
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    headliner,
    venue: row.venue.name,
    city: row.venue.city,
    month: 'TBD',
    day: '—',
    dow: '',
    year: '',
    seat: row.seat,
    price: row.pricePaid ? `$${row.pricePaid}` : null,
    avatarUrl,
    ticketUrl: row.ticketUrl,
  };
}

// Mirror the tRPC vanilla return shape so we don't drop type safety when
// reading via useCachedQuery. The dependency on a tRPC `useUtils` client
// is type-only — Metro does not bundle it.
type ShowsListData = Awaited<
  ReturnType<ReturnType<typeof trpc.useUtils>['client']['shows']['list']['query']>
>;
type ShowsListItem = ShowsListData[number];

export default function ShowsScreen(): React.JSX.Element {
  const breakpoint = useBreakpoint();
  // Tablet: classic two-pane split — the list becomes a sidebar and the
  // selected show renders in place on the right. Phone: the list owns
  // the screen and rows push /show/[id].
  if (breakpoint === 'tablet') {
    return (
      <SplitViewLayout list={<ShowsListPane />} detail={<ShowsDetailPane />} />
    );
  }
  return <ShowsListPane />;
}

function ShowsDetailPane(): React.JSX.Element {
  const { showId } = useSelectedShow();
  const { tokens } = useTheme();
  if (!showId) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.colors.bg }}>
        <EmptyState
          title="Select a show"
          subtitle="Tap a show in the list to see its details here."
        />
      </View>
    );
  }
  return <ShowDetailScreen showIdProp={showId} embeddedInSplitView />;
}

function ShowsListPane(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const utils = trpc.useUtils();
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>('timeline');
  // Top-level state cut: Upcoming (watching/ticketed) vs Past, mirroring
  // the web /upcoming + /logbook split. Mobile keeps the single tab so
  // the 5-tab budget stays intact (per the IA cleanup plan); the
  // segmented control is the in-screen substitute.
  //
  // `?bucket=upcoming|past` lets other screens (home page section
  // arrows) deep-link straight to the right segment.
  const params = useLocalSearchParams<{ bucket?: string }>();
  const initialBucket: 'upcoming' | 'past' =
    params.bucket === 'upcoming' ? 'upcoming' : 'past';
  const [stateBucket, setStateBucket] = React.useState<'upcoming' | 'past'>(initialBucket);
  React.useEffect(() => {
    if (params.bucket === 'upcoming' || params.bucket === 'past') {
      setStateBucket(params.bucket);
    }
  }, [params.bucket]);
  const [actionSheetFor, setActionSheetFor] = React.useState<{
    id: string;
    state: ShowState;
  } | null>(null);
  const [markTicketedForId, setMarkTicketedForId] = React.useState<string | null>(null);
  // Header kind filter, applied on top of the Upcoming/Past bucket. Feeds
  // every mode (timeline / calendar / stats) since they all derive from `rows`.
  const [kindFilter, setKindFilter] = React.useState<KindFilterValue>('all');
  const [searchQuery, setSearchQuery] = React.useState('');

  const showsQuery = useCachedQuery<ShowsListItem[]>({
    queryKey: ['mobile', 'shows.list'],
    queryFn: () => utils.client.shows.list.query({}),
    enabled: Boolean(token),
  });

  // Normalize the tRPC payload into the small shape our views need. Memoize
  // so re-renders from mode/selection changes don't reshape the list.
  const allRows: ShowRow[] = React.useMemo(() => {
    const data = showsQuery.data;
    if (!data) return [];
    return data.map((s) => ({
      id: s.id,
      kind: s.kind as Kind,
      // Effective state: a ticketed show reads as past 3 h after its doors
      // anchor, so tonight's show lands in the Past bucket the same evening.
      state: effectiveShowState(s.state, s.endDate ?? s.date) as ShowState,
      date: s.date,
      endDate: s.endDate ?? null,
      seat: s.seat,
      pricePaid: s.pricePaid,
      productionName: s.productionName,
      coverImageUrl: s.coverImageUrl,
      ticketUrl: s.ticketUrl,
      venue: { id: s.venue.id, name: s.venue.name, city: s.venue.city },
      performers: s.showPerformers.map((sp) => ({
        id: sp.performer.id,
        name: sp.performer.name,
        role: sp.role,
        sortOrder: sp.sortOrder,
        imageUrl: sp.performer.imageUrl ?? null,
      })),
    }));
  }, [showsQuery.data]);

  // Apply the Upcoming/Past state filter. Stats only makes sense for
  // Past; if the user lands on Upcoming with stats selected, force back
  // to timeline.
  const bucketRows: ShowRow[] = React.useMemo(() => {
    if (stateBucket === 'upcoming') {
      return allRows.filter((r) => r.state === 'watching' || r.state === 'ticketed');
    }
    return allRows.filter((r) => r.state === 'past');
  }, [allRows, stateBucket]);

  // Layer the header kind filter on top of the bucket. `bucketRows` (kind
  // unfiltered) is kept so the empty state can tell "no shows in this
  // bucket at all" apart from "no shows of this kind".
  const kindRows: ShowRow[] = React.useMemo(() => {
    if (kindFilter === 'all') return bucketRows;
    return bucketRows.filter((r) => r.kind === kindFilter);
  }, [bucketRows, kindFilter]);

  // Pinned search bar: free-text filter across headliner / cast / support
  // names, venue name + city, and show / festival name (`productionName`).
  // Search is a Timeline-only affordance — Calendar and Stats read the
  // unfiltered (kind-filtered) rows.
  const rows: ShowRow[] = React.useMemo(() => {
    if (mode !== 'timeline' || searchQuery.trim() === '') return kindRows;
    return kindRows.filter((r) =>
      matchesSearchQuery(searchQuery, [
        r.productionName,
        r.venue.name,
        r.venue.city,
        ...r.performers.map((p) => p.name),
      ]),
    );
  }, [kindRows, searchQuery, mode]);

  React.useEffect(() => {
    if (stateBucket === 'upcoming' && mode === 'stats') {
      setMode('timeline');
    }
  }, [stateBucket, mode]);

  const bucketLabel = stateBucket === 'upcoming' ? 'UPCOMING' : 'PAST';
  const eyebrow =
    mode === 'timeline'
      ? `${bucketLabel} · TIMELINE`
      : mode === 'calendar'
        ? `${bucketLabel} · CALENDAR`
        : `${bucketLabel} · STATS`;

  const refreshControl = useThemedRefreshControl(
    showsQuery.isFetching && !showsQuery.isLoading,
    () => {
      void showsQuery.refetch();
    },
  );

  const onLongPressShow = React.useCallback((row: ShowRow) => {
    setActionSheetFor({ id: row.id, state: row.state });
  }, []);

  // In the tablet split view a tap selects the row into the detail pane
  // via the SelectedShow context; on phone we fall back to the existing
  // `<Link>` push to /show/[id]. The branch is local to each row so
  // the same TimelineView / CalendarView code works in both layouts.
  const { showId: selectedShowId, setShowId, isSplitView } = useSelectedShow();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title="Shows"
        eyebrow={eyebrow}
        rightAction={
          <View style={styles.headerActions}>
            <KindFilterControl
              value={kindFilter}
              onChange={setKindFilter}
              testIDPrefix="shows"
            />
            <MeTopBarAction />
          </View>
        }
        large
      />

      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <SegmentedControl<'upcoming' | 'past'>
          value={stateBucket}
          onChange={setStateBucket}
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'past', label: 'Past' },
          ]}
        />
      </View>
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <SegmentedControl<Mode>
          value={mode}
          onChange={setMode}
          options={
            stateBucket === 'upcoming'
              ? [
                  { value: 'timeline', label: 'Timeline' },
                  { value: 'calendar', label: 'Calendar' },
                ]
              : [
                  { value: 'timeline', label: 'Timeline' },
                  { value: 'calendar', label: 'Calendar' },
                  { value: 'stats', label: 'Stats' },
                ]
          }
        />
      </View>

      {allRows.length > 0 && mode === 'timeline' ? (
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search shows, artists, venues…"
          testID="shows-search-input"
        />
      ) : null}

      {showsQuery.isLoading ? (
        <ShowCardListSkeleton count={6} />
      ) : showsQuery.isError ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          refreshControl={refreshControl}
        >
          <EmptyState
            title="Couldn't load shows"
            subtitle={showsQuery.error.message}
            cta={{ label: 'Try again', onPress: () => void showsQuery.refetch() }}
          />
        </ScrollView>
      ) : rows.length === 0 && searchQuery.trim() !== '' && mode === 'timeline' ? (
        // A search is active and nothing matched — a search-specific empty
        // state with a one-tap clear rather than the onboarding hero.
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          refreshControl={refreshControl}
        >
          <EmptyState
            title="No matches"
            subtitle={`Nothing in ${
              stateBucket === 'upcoming' ? 'your upcoming shows' : 'your logbook'
            } matches "${searchQuery.trim()}".`}
            cta={{ label: 'Clear search', onPress: () => setSearchQuery('') }}
          />
        </ScrollView>
      ) : rows.length === 0 && kindFilter !== 'all' ? (
        // A kind filter is active and nothing in this bucket matches it —
        // surface a kind-specific empty state with a one-tap clear rather
        // than the onboarding hero (which would wrongly imply an empty log).
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          refreshControl={refreshControl}
        >
          <EmptyState
            title={`No ${kindFilterNoun(kindFilter as Kind)} shows ${
              stateBucket === 'upcoming' ? 'coming up' : 'logged'
            }`}
            subtitle={
              bucketRows.length > 0
                ? 'Try a different kind, or clear the filter to see everything.'
                : undefined
            }
            cta={{ label: 'Clear filter', onPress: () => setKindFilter('all') }}
          />
        </ScrollView>
      ) : rows.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingVertical: 12 }}
          refreshControl={refreshControl}
        >
          <EmptyStateHero
            kind="shows"
            title={stateBucket === 'upcoming' ? 'Nothing on the calendar' : 'Log your first show'}
            body={
              stateBucket === 'upcoming'
                ? 'Tickets in hand or a date on hold? Add it here and we’ll keep it visible until it’s over.'
                : 'Concerts, theatre, comedy, festivals — the things you saw live, all in one place.'
            }
            action={{ label: 'Add a show', onPress: () => router.push('/add') }}
            secondaryAction={{
              label: 'Find in Discover',
              onPress: () => router.push('/discover'),
            }}
          />
        </ScrollView>
      ) : mode === 'timeline' ? (
        <TimelineView
          rows={rows}
          refreshControl={refreshControl}
          onLongPressShow={onLongPressShow}
          isSplitView={isSplitView}
          selectedShowId={selectedShowId}
          onSelect={setShowId}
        />
      ) : mode === 'calendar' ? (
        <CalendarView
          rows={rows}
          stateBucket={stateBucket}
          refreshControl={refreshControl}
          onLongPressShow={onLongPressShow}
          isSplitView={isSplitView}
          selectedShowId={selectedShowId}
          onSelect={setShowId}
        />
      ) : (
        <StatsView rows={rows} refreshControl={refreshControl} />
      )}

      {actionSheetFor ? (
        <ShowActionSheet
          open
          onClose={() => setActionSheetFor(null)}
          showId={actionSheetFor.id}
          state={actionSheetFor.state}
          onMarkTicketed={() => setMarkTicketedForId(actionSheetFor.id)}
          // In the split view, deleting the show that's open in the
          // detail pane must clear the selection so the pane doesn't
          // keep rendering a dead show.
          onDeleted={
            isSplitView && actionSheetFor.id === selectedShowId
              ? () => setShowId(null)
              : undefined
          }
        />
      ) : null}
      {markTicketedForId ? (
        <MarkTicketedSheet
          open
          onClose={() => setMarkTicketedForId(null)}
          showId={markTicketedForId}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

interface TimelineSection {
  key: string;
  label: string;
  rows: ShowRow[];
}

function buildTimelineSections(rows: ShowRow[]): TimelineSection[] {
  const today = todayISO();

  // Future first (soonest first), then past (most-recent first).
  const future = rows.filter((r) => r.date && r.date >= today);
  const past = rows.filter((r) => !r.date || r.date < today);
  future.sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
  past.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });

  const sections: TimelineSection[] = [];
  if (future.length > 0) sections.push({ key: 'upcoming', label: 'Upcoming', rows: future });

  // Group past by year.
  const byYear = new Map<string, ShowRow[]>();
  for (const r of past) {
    const year = r.date ? r.date.slice(0, 4) : 'No date';
    const arr = byYear.get(year);
    if (arr) arr.push(r);
    else byYear.set(year, [r]);
  }
  for (const [year, list] of byYear) {
    sections.push({ key: `past-${year}`, label: year, rows: list });
  }
  return sections;
}

function TimelineView({
  rows,
  refreshControl,
  onLongPressShow,
  isSplitView,
  selectedShowId,
  onSelect,
}: {
  rows: ShowRow[];
  refreshControl: React.ReactElement<import('react-native').RefreshControlProps>;
  onLongPressShow: (row: ShowRow) => void;
  isSplitView: boolean;
  selectedShowId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { token } = useAuth();
  const sections = React.useMemo(() => buildTimelineSections(rows), [rows]);

  // Flat, section-order index per row id so Maestro flows can target the
  // first row deterministically as `show-card-row-0` (the SectionList's
  // own renderItem index resets per section, which would yield duplicate
  // ids across sections).
  const rowIndexById = React.useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const section of sections) {
      for (const r of section.rows) map.set(r.id, i++);
    }
    return map;
  }, [sections]);

  // Row density mirrors web: driven by the server-synced
  // `preferences.compactMode` so the choice follows the user across
  // devices (web's ShowsListView reads the same field). Until the
  // query resolves we fall back to the comfortable card style.
  const prefsQuery = trpc.preferences.get.useQuery(undefined, {
    enabled: Boolean(token),
  });
  const compact = prefsQuery.data?.preferences?.compactMode ?? false;

  // SectionList virtualises rows, so a power user with hundreds of past
  // shows doesn't pay a per-row mount on first render. Sticky headers
  // keep the year / "Upcoming" label visible while scrolling.
  //
  // Perf props: initial render covers the typical first screen (a
  // section header + the upcoming/recent rail's first eight rows on a
  // 390×844 viewport). windowSize=11 means ~5 viewports above + 5
  // below stay mounted — generous enough to avoid white flashes
  // mid-fling, tight enough to bound memory on heavy logs. The
  // batch-render cap keeps each JS frame under ~16ms on mid-tier
  // Android by feeding rows in waves rather than one giant pass.
  //
  // `removeClippedSubviews` is deliberately off: React Native warns it
  // "may have bugs (missing content)" and the combination with sticky
  // section headers reliably reproduced a stuck/blank list after tab or
  // segmented-control switches in this screen. The window/batch tuning
  // above is enough virtualisation for the typical log size.
  return (
    <SectionList<ShowRow, TimelineSection>
      sections={sections.map((s) => ({ ...s, data: s.rows }))}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={refreshControl}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      windowSize={11}
      renderSectionHeader={({ section }) => (
        <View
          style={[
            styles.sectionHeader,
            {
              borderBottomColor: colors.rule,
              backgroundColor: colors.bg,
            },
          ]}
        >
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>
            {section.label.toUpperCase()}
          </Text>
          <Text style={[styles.sectionCount, { color: colors.faint }]}>
            {section.rows.length}
          </Text>
        </View>
      )}
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: 20 }}>
          <RowCard
            row={item}
            isSplitView={isSplitView}
            selected={selectedShowId === item.id}
            onSelect={onSelect}
            onLongPress={() => onLongPressShow(item)}
            compact={compact}
            testID={`show-card-row-${rowIndexById.get(item.id) ?? 0}`}
          />
        </View>
      )}
    />
  );
}

/**
 * Single row that branches navigation based on whether we're inside the
 * tablet split view. Split view: tap → context selection, row renders a
 * highlight instead of a push chevron. Phone: tap → push the /show/[id]
 * route via expo-router's Link.
 */
function RowCard({
  row,
  isSplitView,
  selected,
  onSelect,
  onLongPress,
  compact,
  testID,
}: {
  row: ShowRow;
  isSplitView: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onLongPress: () => void;
  compact?: boolean;
  testID?: string;
}): React.JSX.Element {
  const { token } = useAuth();
  const card = toShowCard(row, token);
  if (isSplitView) {
    return (
      <ShowCard
        show={card}
        compact={compact}
        selected={selected}
        onPress={() => onSelect(row.id)}
        onLongPress={onLongPress}
        testID={testID}
      />
    );
  }
  // Suppress the unused-selected warning on phone — selection is tablet-only.
  void selected;
  return (
    <Link href={`/show/${row.id}`} asChild>
      <ShowCard
        show={card}
        compact={compact}
        onLongPress={onLongPress}
        testID={testID}
      />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Calendar (Month + Year)
// ---------------------------------------------------------------------------

function CalendarView({
  rows,
  stateBucket,
  refreshControl,
  onLongPressShow,
  isSplitView,
  selectedShowId,
  onSelect,
}: {
  rows: ShowRow[];
  stateBucket: 'upcoming' | 'past';
  refreshControl: React.ReactElement<import('react-native').RefreshControlProps>;
  onLongPressShow: (row: ShowRow) => void;
  isSplitView: boolean;
  selectedShowId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const today = todayISO();
  const todayDate = parseLocalDate(today);
  const todayCursor = React.useMemo(
    () => ({ year: todayDate.getFullYear(), month: todayDate.getMonth() }),
    [todayDate],
  );
  const [cursor, setCursor] = React.useState(todayCursor);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [calendarMode, setCalendarMode] = React.useState<CalendarMode>('month');

  const eventsByDay = React.useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const r of rows) {
      if (!r.date) continue;
      // Multi-day events render as a spanning bar (see `spanEvents` below)
      // instead of repeating a dot on every day of the run.
      if (r.endDate && r.endDate > r.date) continue;
      const list = map[r.date] ?? (map[r.date] = []);
      list.push({ kind: r.kind, state: r.state });
    }
    return map;
  }, [rows]);

  const spanEvents = React.useMemo<CalendarSpan[]>(() => {
    const out: CalendarSpan[] = [];
    for (const r of rows) {
      if (!r.date || !r.endDate || r.endDate <= r.date) continue;
      out.push({
        id: r.id,
        startISO: r.date,
        endISO: r.endDate,
        kind: r.kind,
        state: r.state,
      });
    }
    return out;
  }, [rows]);

  const monthPrefix = `${cursor.year}-${pad2(cursor.month + 1)}-`;
  const yearPrefix = `${cursor.year}-`;
  const rowsInMonth = React.useMemo(
    () =>
      rows
        .filter((r) => r.date && r.date.startsWith(monthPrefix))
        .sort((a, b) => (a.date! < b.date! ? -1 : 1)),
    [rows, monthPrefix],
  );
  const rowsInYear = React.useMemo(
    () =>
      rows
        .filter((r) => r.date && r.date.startsWith(yearPrefix))
        .sort((a, b) => (a.date! < b.date! ? -1 : 1)),
    [rows, yearPrefix],
  );

  const visibleRows = selected
    ? rowsInMonth.filter((r) => {
        if (!r.date) return false;
        if (r.date === selected) return true;
        if (r.endDate && r.date <= selected && selected <= r.endDate) return true;
        return false;
      })
    : rowsInMonth;

  const scopeRows = calendarMode === 'year' ? rowsInYear : rowsInMonth;
  const counts = React.useMemo(() => {
    let past = 0, ticketed = 0, watching = 0;
    for (const r of scopeRows) {
      if (r.state === 'past') past += 1;
      else if (r.state === 'ticketed') ticketed += 1;
      else watching += 1;
    }
    return { past, ticketed, watching };
  }, [scopeRows]);

  // Bounds: Jan of earliest show year through Dec of latest show year,
  // clamped so navigation can't cross the "today" boundary in the
  // wrong direction — Upcoming stops at the current month going back,
  // Past stops at the current month going forward.
  const bounds = React.useMemo(
    () =>
      computeMonthBounds({
        showDates: rows.map((r) => r.date),
        stateBucket,
        today: todayCursor,
      }),
    [rows, stateBucket, todayCursor],
  );

  // Snap the cursor back inside bounds when the bucket flips (e.g. user
  // is viewing Aug 2027 in Upcoming, switches to Past — that month is
  // now beyond the Past max).
  React.useEffect(() => {
    setCursor((c) => {
      if (c.year < bounds.min.year || (c.year === bounds.min.year && c.month < bounds.min.month)) {
        return bounds.min;
      }
      if (c.year > bounds.max.year || (c.year === bounds.max.year && c.month > bounds.max.month)) {
        return bounds.max;
      }
      return c;
    });
  }, [bounds]);

  const atMinMonth = atMinCursor(cursor, bounds);
  const atMaxMonth = atMaxCursor(cursor, bounds);
  const atMinYear = cursor.year <= bounds.min.year;
  const atMaxYear = cursor.year >= bounds.max.year;
  const atMin = calendarMode === 'year' ? atMinYear : atMinMonth;
  const atMax = calendarMode === 'year' ? atMaxYear : atMaxMonth;

  const step = React.useCallback(
    (delta: number) => {
      setSelected(null);
      if (calendarMode === 'year') {
        setCursor((c) => {
          const next = c.year + delta;
          if (next < bounds.min.year || next > bounds.max.year) return c;
          return { year: next, month: c.month };
        });
      } else {
        setCursor((c) => stepCursor(c, delta, bounds));
      }
    },
    [calendarMode, bounds],
  );

  // Horizontal swipe to step between periods (month or year), mirroring the
  // prev/next arrow buttons. The grid follows the finger with a damped drag
  // (extra resistance when a swipe would cross a navigation bound) and a swipe
  // past the threshold commits the step. `activeOffsetX` keeps day-cell taps
  // working, and `failOffsetY` defers vertical drags to the parent ScrollView.
  const dragX = useSharedValue(0);

  // One-time swipe-discovery hint. The Pan gesture is invisible, so a
  // first-time user only ever finds the prev/next arrows. We surface a
  // transient animated caption ("Swipe to change months") and a one-shot
  // grid nudge until the user either swipes or taps the hint away, then
  // persist the flag (expo-secure-store, matching TicketStatusHint).
  // `null` = still reading storage — keeps the hint from flashing for
  // users who already saw it.
  const [swipeHintSeen, setSwipeHintSeen] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync('showbook.hint.calendar-swipe')
      .then((v) => {
        if (!cancelled) setSwipeHintSeen(v === '1');
      })
      // Fail "seen": a storage read error shouldn't strand an
      // un-dismissable nag (the matching write would fail too).
      .catch(() => {
        if (!cancelled) setSwipeHintSeen(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const markSwipeHintSeen = React.useCallback(() => {
    setSwipeHintSeen(true);
    SecureStore.setItemAsync('showbook.hint.calendar-swipe', '1').catch(() => {
      // ignore — local state already flipped the hint off
    });
  }, []);

  // Play the grid nudge once, the first time we know the hint is unseen.
  const nudgedRef = React.useRef(false);
  React.useEffect(() => {
    if (swipeHintSeen !== false || nudgedRef.current) return;
    nudgedRef.current = true;
    dragX.value = withDelay(
      450,
      withSequence(
        withTiming(-26, { duration: 340, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 520, easing: Easing.inOut(Easing.quad) }),
      ),
    );
  }, [swipeHintSeen, dragX]);

  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-16, 16])
    .onUpdate((e) => {
      'worklet';
      const blocked =
        (e.translationX > 0 && atMin) || (e.translationX < 0 && atMax);
      dragX.value = e.translationX * (blocked ? 0.18 : 0.42);
    })
    .onEnd((e) => {
      'worklet';
      // Swipe left → next period, swipe right → previous period.
      const delta = e.translationX < 0 ? 1 : -1;
      const passed =
        Math.abs(e.translationX) > 56 || Math.abs(e.velocityX) > 550;
      const blocked = (delta < 0 && atMin) || (delta > 0 && atMax);
      if (passed) {
        // A committed swipe (even one blocked at a bound) means the user
        // found the gesture — retire the hint.
        runOnJS(markSwipeHintSeen)();
        if (!blocked) runOnJS(step)(delta);
      }
      dragX.value = withTiming(0, { duration: 180 });
    });

  const swipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }],
  }));

  const goToday = () => {
    setSelected(null);
    setCursor(todayCursor);
  };

  const onSelectYearMonth = (month: number) => {
    setSelected(null);
    setCursor({ year: cursor.year, month });
    setCalendarMode('month');
  };

  const isMonthInBounds = (month: number): boolean => {
    if (cursor.year < bounds.min.year || cursor.year > bounds.max.year) return false;
    if (cursor.year === bounds.min.year && month < bounds.min.month) return false;
    if (cursor.year === bounds.max.year && month > bounds.max.month) return false;
    return true;
  };

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}
      refreshControl={refreshControl}
    >
      <SegmentedControl<CalendarMode>
        value={calendarMode}
        onChange={(v) => {
          setSelected(null);
          setCalendarMode(v);
        }}
        options={[
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
        ]}
      />

      <View style={styles.monthBar}>
        <View style={{ flex: 1 }}>
          {calendarMode === 'year' ? (
            <Text style={[styles.monthTitle, { color: colors.ink }]}>
              {cursor.year}
            </Text>
          ) : (
            <Text style={[styles.monthTitle, { color: colors.ink }]}>
              {MONTH_LONG[cursor.month]}{' '}
              <Text style={{ color: colors.faint, fontWeight: '400' }}>{cursor.year}</Text>
            </Text>
          )}
          <Text style={[styles.monthCount, { color: colors.muted }]}>
            {counts.past} past · {counts.ticketed} ticketed · {counts.watching} watching
          </Text>
        </View>
        <View style={[styles.monthNav, { borderColor: colors.ruleStrong }]}>
          <Pressable
            onPress={() => step(-1)}
            disabled={atMin}
            accessibilityLabel={calendarMode === 'year' ? 'Previous year' : 'Previous month'}
            accessibilityState={{ disabled: atMin }}
            style={[styles.monthNavBtn, { borderRightColor: colors.ruleStrong, borderRightWidth: StyleSheet.hairlineWidth, opacity: atMin ? 0.4 : 1 }]}
          >
            <ChevronLeft size={16} color={colors.ink} />
          </Pressable>
          <Pressable
            onPress={goToday}
            accessibilityLabel="Today"
            style={[styles.monthNavBtn, { borderRightColor: colors.ruleStrong, borderRightWidth: StyleSheet.hairlineWidth }]}
          >
            <Text style={[styles.monthNavLabel, { color: colors.ink }]}>Today</Text>
          </Pressable>
          <Pressable
            onPress={() => step(1)}
            disabled={atMax}
            accessibilityLabel={calendarMode === 'year' ? 'Next year' : 'Next month'}
            accessibilityState={{ disabled: atMax }}
            style={[styles.monthNavBtn, { opacity: atMax ? 0.4 : 1 }]}
          >
            <ChevronRight size={16} color={colors.ink} />
          </Pressable>
        </View>
      </View>

      <CalendarSwipeHint
        visible={swipeHintSeen === false}
        period={calendarMode === 'year' ? 'year' : 'month'}
        onDismiss={markSwipeHintSeen}
      />

      <GestureDetector gesture={swipeGesture}>
        <Animated.View style={swipeStyle}>
          {calendarMode === 'year' ? (
            <View style={styles.yearGrid}>
              {Array.from({ length: 12 }, (_, m) => (
                <View key={m} style={styles.yearTileWrap}>
                  <MiniMonth
                    year={cursor.year}
                    month={m}
                    events={eventsByDay}
                    spans={spanEvents}
                    todayISO={today}
                    onPress={() => onSelectYearMonth(m)}
                    disabled={!isMonthInBounds(m)}
                  />
                </View>
              ))}
            </View>
          ) : (
            <CalendarGrid
              year={cursor.year}
              month={cursor.month}
              events={eventsByDay}
              spans={spanEvents}
              todayISO={today}
              selectedISO={selected}
              onSelectDay={(iso) => setSelected((cur) => (cur === iso ? null : iso))}
            />
          )}
        </Animated.View>
      </GestureDetector>

      {calendarMode === 'month' ? (
        <View style={{ gap: 8 }}>
          <Text style={[styles.sectionLabelInline, { color: colors.muted }]}>
            {selected
              ? formatSelectedHeading(selected)
              : `THIS MONTH · ${rowsInMonth.length}`}
          </Text>
          {visibleRows.length === 0 ? (
            <Text style={{ color: colors.faint, fontFamily: 'Geist Sans', fontSize: 13 }}>
              {selected ? 'No shows on this day.' : 'No shows this month.'}
            </Text>
          ) : (
            visibleRows.map((row) => (
              <RowCard
                key={row.id}
                row={row}
                isSplitView={isSplitView}
                selected={selectedShowId === row.id}
                onSelect={onSelect}
                onLongPress={() => onLongPressShow(row)}
              />
            ))
          )}
        </View>
      ) : rowsInYear.length === 0 ? (
        <Text style={{ color: colors.faint, fontFamily: 'Geist Sans', fontSize: 13 }}>
          No shows this year.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function formatSelectedHeading(iso: string): string {
  const d = parseLocalDate(iso);
  return `${DOW_SHORT[d.getDay()]} · ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

interface Stats {
  total: number;
  spent: number;
  venueCount: number;
  artistCount: number;
  byKind: { kind: Kind; count: number }[];
  topPerformers: { id: string; name: string; count: number; kind: Kind }[];
  topVenues: { id: string; name: string; city: string | null; count: number }[];
}

function buildStats(rows: ShowRow[]): Stats {
  let spent = 0;
  const venueCounts = new Map<string, { id: string; name: string; city: string | null; count: number }>();
  const performerCounts = new Map<string, { id: string; name: string; count: number; kind: Kind }>();
  const kindCounts = new Map<Kind, number>();

  for (const r of rows) {
    spent += priceCents(r);
    const v = venueCounts.get(r.venue.id);
    if (v) v.count += 1;
    else venueCounts.set(r.venue.id, { id: r.venue.id, name: r.venue.name, city: r.venue.city, count: 1 });

    kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);

    for (const p of r.performers) {
      if (p.role !== 'headliner') continue;
      const cur = performerCounts.get(p.id);
      if (cur) cur.count += 1;
      else performerCounts.set(p.id, { id: p.id, name: p.name, count: 1, kind: r.kind });
    }
  }

  const byKind: { kind: Kind; count: number }[] = [...kindCounts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    spent: Math.round(spent / 100),
    venueCount: venueCounts.size,
    artistCount: performerCounts.size,
    byKind,
    topPerformers: [...performerCounts.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    topVenues: [...venueCounts.values()].sort((a, b) => b.count - a.count).slice(0, 5),
  };
}

function formatMoney(dollars: number): string {
  return `$${dollars.toLocaleString('en-US')}`;
}

function StatsView({
  rows,
  refreshControl,
}: {
  rows: ShowRow[];
  refreshControl: React.ReactElement<import('react-native').RefreshControlProps>;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const [selectedYear, setSelectedYear] = React.useState<number | null>(null);

  const yearGroups = React.useMemo<FilterGroup[]>(() => {
    const counts = new Map<number, number>();
    for (const r of rows) {
      if (!r.date) continue;
      const y = Number(r.date.slice(0, 4));
      if (!Number.isFinite(y)) continue;
      counts.set(y, (counts.get(y) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, count]) => ({
        id: String(year),
        name: String(year),
        count,
      }));
  }, [rows]);

  React.useEffect(() => {
    if (selectedYear !== null && !yearGroups.some((g) => g.id === String(selectedYear))) {
      setSelectedYear(null);
    }
  }, [yearGroups, selectedYear]);

  const filteredRows = React.useMemo(() => {
    if (selectedYear === null) return rows;
    const prefix = `${selectedYear}-`;
    return rows.filter((r) => r.date != null && r.date.startsWith(prefix));
  }, [rows, selectedYear]);

  const stats = React.useMemo(() => buildStats(filteredRows), [filteredRows]);
  const maxPerformer = stats.topPerformers[0]?.count ?? 1;
  const maxVenue = stats.topVenues[0]?.count ?? 1;

  return (
    <View style={{ flex: 1 }}>
      {yearGroups.length > 1 ? (
        <FilterChipsRow
          groups={yearGroups}
          selected={selectedYear !== null ? String(selectedYear) : null}
          onSelect={(id) => setSelectedYear(id === null ? null : Number(id))}
          totalCount={rows.length}
          allLabel="All time"
          variant="sub"
          testIdPrefix="stats-year-chip"
        />
      ) : null}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 16 }}
        refreshControl={refreshControl}
      >
      <View style={[styles.statGrid, { backgroundColor: colors.rule }]}>
        <StatTile value={String(stats.total)} label="shows" />
        <StatTile value={formatMoney(stats.spent)} label="spent" />
        <StatTile value={String(stats.venueCount)} label="venues" />
        <StatTile value={String(stats.artistCount)} label="artists" />
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>BY KIND</Text>
        {stats.byKind.length === 0 ? (
          <Text style={{ color: colors.faint, fontFamily: 'Geist Sans', fontSize: 13 }}>
            No shows yet.
          </Text>
        ) : (
          stats.byKind.map((row) => {
            const pct = stats.total > 0 ? row.count / stats.total : 0;
            return (
              <View key={row.kind} style={{ paddingVertical: 8 }}>
                <View style={styles.kindRowHeader}>
                  <Text style={[styles.kindLabel, { color: tokens.kindColor(row.kind) }]}>
                    {row.kind.toUpperCase()}
                  </Text>
                  <Text style={[styles.kindCount, { color: colors.ink }]}>
                    {row.count} · {Math.round(pct * 100)}%
                  </Text>
                </View>
                <View style={[styles.barTrack, { backgroundColor: colors.surfaceRaised }]}>
                  <View
                    style={{
                      width: `${pct * 100}%`,
                      height: '100%',
                      backgroundColor: tokens.kindColor(row.kind),
                    }}
                  />
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>MOST SEEN</Text>
          <Text style={[styles.cardSub, { color: colors.faint }]}>top headliners</Text>
        </View>
        {stats.topPerformers.length === 0 ? (
          <Text style={{ color: colors.faint, fontFamily: 'Geist Sans', fontSize: 13 }}>
            No headliners recorded yet.
          </Text>
        ) : (
          stats.topPerformers.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => router.push(`/artists/${p.id}`)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${p.name}`}
              style={({ pressed }) => [
                styles.rankRow,
                { borderBottomColor: colors.rule },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text
                style={[styles.rankName, { color: colors.ink }]}
                numberOfLines={1}
              >
                {p.name}
              </Text>
              <View style={[styles.rankBarTrack, { backgroundColor: colors.surfaceRaised }]}>
                <View
                  style={{
                    width: `${(p.count / maxPerformer) * 100}%`,
                    height: '100%',
                    backgroundColor: tokens.kindColor(p.kind),
                  }}
                />
              </View>
              <Text style={[styles.rankCount, { color: colors.ink }]}>{p.count}×</Text>
            </Pressable>
          ))
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>MOST FREQUENTED</Text>
          <Text style={[styles.cardSub, { color: colors.faint }]}>venues</Text>
        </View>
        {stats.topVenues.length === 0 ? (
          <Text style={{ color: colors.faint, fontFamily: 'Geist Sans', fontSize: 13 }}>
            No venues recorded yet.
          </Text>
        ) : (
          stats.topVenues.map((v) => (
            <Pressable
              key={v.id}
              onPress={() => router.push(`/venues/${v.id}`)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${v.name}`}
              style={({ pressed }) => [
                styles.rankRow,
                { borderBottomColor: colors.rule },
                pressed && { opacity: 0.6 },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rankName, { color: colors.ink }]} numberOfLines={1}>
                  {v.name}
                </Text>
                {v.city && (
                  <Text style={[styles.rankSub, { color: colors.muted }]} numberOfLines={1}>
                    {v.city}
                  </Text>
                )}
              </View>
              <View style={[styles.rankBarTrack, { backgroundColor: colors.surfaceRaised }]}>
                <View
                  style={{
                    width: `${(v.count / maxVenue) * 100}%`,
                    height: '100%',
                    backgroundColor: colors.ink,
                  }}
                />
              </View>
              <Text style={[styles.rankCount, { color: colors.ink }]}>{v.count}</Text>
            </Pressable>
          ))
        )}
      </View>
      </ScrollView>
    </View>
  );
}

function StatTile({ value, label }: { value: string; label: string }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View style={[styles.statTile, { backgroundColor: colors.surface }]}>
      <Text style={[styles.statValue, { color: colors.ink }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 11,
    letterSpacing: 1.1,
  },
  sectionCount: {
    fontFamily: 'Geist Sans 500',
    fontSize: 11,
  },
  sectionLabelInline: {
    fontFamily: 'Geist Sans 600',
    fontSize: 11,
    letterSpacing: 1.1,
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  monthTitle: {
    fontFamily: 'Geist Sans 700',
    fontSize: 22,
    letterSpacing: -0.4,
  },
  monthCount: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    marginTop: 2,
    letterSpacing: 0.4,
  },
  monthNav: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  monthNavBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavLabel: {
    fontFamily: 'Geist Sans 500',
    fontSize: 13,
  },
  yearGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  yearTileWrap: {
    width: '33.3333%',
    padding: 4,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: StyleSheet.hairlineWidth,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  statTile: {
    width: `${(100 - 0.5) / 2}%`,
    paddingVertical: 16,
    paddingHorizontal: 16,
    minWidth: 0,
    flexGrow: 1,
  },
  statValue: {
    fontFamily: 'Geist Sans 700',
    fontSize: 28,
    letterSpacing: -0.6,
  },
  statLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 6,
  },
  card: {
    borderRadius: RADII.lg,
    padding: 16,
    gap: 4,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardTitle: {
    fontFamily: 'Geist Sans 700',
    fontSize: 11,
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  cardSub: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
  },
  kindRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  kindLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  kindCount: {
    fontFamily: 'Geist Sans 500',
    fontSize: 12,
  },
  barTrack: {
    height: 6,
    borderRadius: RADII.pill,
    overflow: 'hidden',
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rankName: {
    flex: 1,
    fontFamily: 'Geist Sans 500',
    fontSize: 14,
    minWidth: 0,
  },
  rankSub: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    marginTop: 2,
  },
  rankBarTrack: {
    width: 100,
    height: 8,
    borderRadius: RADII.pill,
    overflow: 'hidden',
  },
  rankCount: {
    fontFamily: 'Geist Sans 600',
    fontSize: 12,
    minWidth: 26,
    textAlign: 'right',
  },
});

