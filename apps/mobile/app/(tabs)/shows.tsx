/**
 * Shows tab — Timeline / Month / Stats.
 *
 * Three modes share a single `shows.list` query (the procedure already
 * returns the venue + performer object graph we need). Per-mode views
 * derive their data client-side from that one list:
 *
 *   - Timeline: a flat, chronological feed grouped by year. Future shows
 *     first (soonest first), then past (most-recent first). Compact
 *     ShowCards reuse the existing component.
 *   - Month:    a custom 7×6 grid (CalendarGrid) plus a side list of
 *     events for the selected day / month. Hand-rolled — no calendar lib.
 *   - Stats:    headline counts (shows / spent / venues / artists), a
 *     by-kind mix bar, and top-5 lists for performers and venues. Derived
 *     from the same list — no separate `shows.stats` procedure exists yet.
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
import { Link } from 'expo-router';
import { ChevronLeft, ChevronRight, List as ListIcon } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { SegmentedControl } from '../../components/SegmentedControl';
import { ShowCard, type ShowCardShow } from '../../components/ShowCard';
import { EmptyState } from '../../components/EmptyState';
import { ShowCardListSkeleton } from '../../components/skeletons';
import { CalendarGrid, type CalendarEvent } from '../../components/CalendarGrid';
import { ShowActionSheet } from '../../components/ShowActionSheet';
import { useSelectedShow } from '../../components/ThreePaneLayout';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import { useTheme, type Kind, type ShowState } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { useCachedQuery } from '../../lib/cache';
import { useAuth } from '../../lib/auth';

type Mode = 'timeline' | 'month' | 'stats';

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
  seat: string | null;
  pricePaid: string | null;
  productionName: string | null;
  venue: { name: string; city: string | null };
  performers: { name: string; role: 'headliner' | 'support' | 'cast'; sortOrder: number }[];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function headlinerOf(row: ShowRow): string {
  const headliners = row.performers
    .filter((p) => p.role === 'headliner')
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (headliners.length > 0) return headliners[0].name;
  if (row.productionName) return row.productionName;
  return 'Untitled show';
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

function toShowCard(row: ShowRow): ShowCardShow {
  const headliner = headlinerOf(row);
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
      seat: row.seat,
      price: row.pricePaid ? `$${row.pricePaid}` : null,
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
    seat: row.seat,
    price: row.pricePaid ? `$${row.pricePaid}` : null,
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
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const utils = trpc.useUtils();
  const [mode, setMode] = React.useState<Mode>('timeline');
  // Top-level state cut: Upcoming (watching/ticketed) vs Past, mirroring
  // the web /upcoming + /logbook split. Mobile keeps the single tab so
  // the 5-tab budget stays intact (per the IA cleanup plan); the
  // segmented control is the in-screen substitute.
  const [stateBucket, setStateBucket] = React.useState<'upcoming' | 'past'>('past');
  const [actionSheetFor, setActionSheetFor] = React.useState<{
    id: string;
    state: ShowState;
  } | null>(null);

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
      state: s.state as ShowState,
      date: s.date,
      seat: s.seat,
      pricePaid: s.pricePaid,
      productionName: s.productionName,
      venue: { name: s.venue.name, city: s.venue.city },
      performers: s.showPerformers.map((sp) => ({
        name: sp.performer.name,
        role: sp.role,
        sortOrder: sp.sortOrder,
      })),
    }));
  }, [showsQuery.data]);

  // Apply the Upcoming/Past state filter. Stats only makes sense for
  // Past; if the user lands on Upcoming with stats selected, force back
  // to timeline.
  const rows: ShowRow[] = React.useMemo(() => {
    if (stateBucket === 'upcoming') {
      return allRows.filter((r) => r.state === 'watching' || r.state === 'ticketed');
    }
    return allRows.filter((r) => r.state === 'past');
  }, [allRows, stateBucket]);

  React.useEffect(() => {
    if (stateBucket === 'upcoming' && mode === 'stats') {
      setMode('timeline');
    }
  }, [stateBucket, mode]);

  const bucketLabel = stateBucket === 'upcoming' ? 'UPCOMING' : 'PAST';
  const eyebrow =
    mode === 'timeline'
      ? `${bucketLabel} · TIMELINE`
      : mode === 'month'
        ? `${bucketLabel} · MONTH`
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

  // On iPad three-pane the tap selects the row in the middle pane via
  // the SelectedShow context; on phone we fall back to the existing
  // `<Link>` push to /show/[id]. The branch is local to each row so
  // the same TimelineView / MonthView code works in both layouts.
  const { showId: selectedShowId, setShowId, isThreePane } = useSelectedShow();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Shows" eyebrow={eyebrow} large />

      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
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
                  { value: 'month', label: 'Month' },
                ]
              : [
                  { value: 'timeline', label: 'Timeline' },
                  { value: 'month', label: 'Month' },
                  { value: 'stats', label: 'Stats' },
                ]
          }
        />
      </View>

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
      ) : rows.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          refreshControl={refreshControl}
        >
          <EmptyState
            icon={<ListIcon size={40} color={colors.faint} strokeWidth={1.5} />}
            title="No shows yet"
            subtitle="Add a show from the + tab to get started."
          />
        </ScrollView>
      ) : mode === 'timeline' ? (
        <TimelineView
          rows={rows}
          refreshControl={refreshControl}
          onLongPressShow={onLongPressShow}
          isThreePane={isThreePane}
          selectedShowId={selectedShowId}
          onSelect={setShowId}
        />
      ) : mode === 'month' ? (
        <MonthView
          rows={rows}
          refreshControl={refreshControl}
          onLongPressShow={onLongPressShow}
          isThreePane={isThreePane}
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
  isThreePane,
  selectedShowId,
  onSelect,
}: {
  rows: ShowRow[];
  refreshControl: React.ReactElement<import('react-native').RefreshControlProps>;
  onLongPressShow: (row: ShowRow) => void;
  isThreePane: boolean;
  selectedShowId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const sections = React.useMemo(() => buildTimelineSections(rows), [rows]);

  // SectionList virtualises rows, so a power user with hundreds of past
  // shows doesn't pay a per-row mount on first render. Sticky headers
  // keep the year / "Upcoming" label visible while scrolling.
  return (
    <SectionList<ShowRow, TimelineSection>
      sections={sections.map((s) => ({ ...s, data: s.rows }))}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={refreshControl}
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
            isThreePane={isThreePane}
            selected={selectedShowId === item.id}
            onSelect={onSelect}
            onLongPress={() => onLongPressShow(item)}
            compact
          />
        </View>
      )}
    />
  );
}

/**
 * Single row that branches navigation based on whether we're inside the
 * iPad three-pane shell. On iPad: tap → context selection. On phone:
 * tap → push the /show/[id] route via expo-router's Link.
 */
function RowCard({
  row,
  isThreePane,
  selected,
  onSelect,
  onLongPress,
  compact,
}: {
  row: ShowRow;
  isThreePane: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onLongPress: () => void;
  compact?: boolean;
}): React.JSX.Element {
  const card = toShowCard(row);
  if (isThreePane) {
    return (
      <ShowCard
        show={card}
        compact={compact}
        onPress={() => onSelect(row.id)}
        onLongPress={onLongPress}
      />
    );
  }
  // Suppress the unused-selected warning on phone — selection is iPad-only.
  void selected;
  return (
    <Link href={`/show/${row.id}`} asChild>
      <ShowCard show={card} compact={compact} onLongPress={onLongPress} />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Month
// ---------------------------------------------------------------------------

function MonthView({
  rows,
  refreshControl,
  onLongPressShow,
  isThreePane,
  selectedShowId,
  onSelect,
}: {
  rows: ShowRow[];
  refreshControl: React.ReactElement<import('react-native').RefreshControlProps>;
  onLongPressShow: (row: ShowRow) => void;
  isThreePane: boolean;
  selectedShowId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const today = todayISO();
  const todayDate = parseLocalDate(today);
  const [cursor, setCursor] = React.useState({ year: todayDate.getFullYear(), month: todayDate.getMonth() });
  const [selected, setSelected] = React.useState<string | null>(null);

  const eventsByDay = React.useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const r of rows) {
      if (!r.date) continue;
      const list = map[r.date] ?? (map[r.date] = []);
      list.push({ kind: r.kind, state: r.state });
    }
    return map;
  }, [rows]);

  const monthPrefix = `${cursor.year}-${pad2(cursor.month + 1)}-`;
  const rowsInMonth = React.useMemo(
    () =>
      rows
        .filter((r) => r.date && r.date.startsWith(monthPrefix))
        .sort((a, b) => (a.date! < b.date! ? -1 : 1)),
    [rows, monthPrefix],
  );

  const visibleRows = selected ? rowsInMonth.filter((r) => r.date === selected) : rowsInMonth;

  const counts = React.useMemo(() => {
    let past = 0, ticketed = 0, watching = 0;
    for (const r of rowsInMonth) {
      if (r.state === 'past') past += 1;
      else if (r.state === 'ticketed') ticketed += 1;
      else watching += 1;
    }
    return { past, ticketed, watching };
  }, [rowsInMonth]);

  const step = (delta: number) => {
    setSelected(null);
    setCursor((c) => {
      const m = c.month + delta;
      if (m < 0) return { year: c.year - 1, month: 11 };
      if (m > 11) return { year: c.year + 1, month: 0 };
      return { year: c.year, month: m };
    });
  };

  const goToday = () => {
    setSelected(null);
    setCursor({ year: todayDate.getFullYear(), month: todayDate.getMonth() });
  };

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, gap: 14 }}
      refreshControl={refreshControl}
    >
      <View style={styles.monthBar}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.monthTitle, { color: colors.ink }]}>
            {MONTH_LONG[cursor.month]}{' '}
            <Text style={{ color: colors.faint, fontWeight: '400' }}>{cursor.year}</Text>
          </Text>
          <Text style={[styles.monthCount, { color: colors.muted }]}>
            {counts.past} past · {counts.ticketed} ticketed · {counts.watching} watching
          </Text>
        </View>
        <View style={[styles.monthNav, { borderColor: colors.ruleStrong }]}>
          <Pressable
            onPress={() => step(-1)}
            accessibilityLabel="Previous month"
            style={[styles.monthNavBtn, { borderRightColor: colors.ruleStrong, borderRightWidth: StyleSheet.hairlineWidth }]}
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
            accessibilityLabel="Next month"
            style={styles.monthNavBtn}
          >
            <ChevronRight size={16} color={colors.ink} />
          </Pressable>
        </View>
      </View>

      <CalendarGrid
        year={cursor.year}
        month={cursor.month}
        events={eventsByDay}
        todayISO={today}
        selectedISO={selected}
        onSelectDay={(iso) => setSelected((cur) => (cur === iso ? null : iso))}
      />

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
              isThreePane={isThreePane}
              selected={selectedShowId === row.id}
              onSelect={onSelect}
              onLongPress={() => onLongPressShow(row)}
            />
          ))
        )}
      </View>
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
  topPerformers: { name: string; count: number; kind: Kind }[];
  topVenues: { name: string; city: string | null; count: number }[];
}

function buildStats(rows: ShowRow[]): Stats {
  let spent = 0;
  const venueCounts = new Map<string, { name: string; city: string | null; count: number }>();
  const performerCounts = new Map<string, { name: string; count: number; kind: Kind }>();
  const kindCounts = new Map<Kind, number>();

  for (const r of rows) {
    spent += priceCents(r);
    const venueKey = r.venue.name;
    const v = venueCounts.get(venueKey);
    if (v) v.count += 1;
    else venueCounts.set(venueKey, { name: r.venue.name, city: r.venue.city, count: 1 });

    kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);

    for (const p of r.performers) {
      if (p.role !== 'headliner') continue;
      const cur = performerCounts.get(p.name);
      if (cur) cur.count += 1;
      else performerCounts.set(p.name, { name: p.name, count: 1, kind: r.kind });
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
  const stats = React.useMemo(() => buildStats(rows), [rows]);
  const maxPerformer = stats.topPerformers[0]?.count ?? 1;
  const maxVenue = stats.topVenues[0]?.count ?? 1;

  return (
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
            <View key={p.name} style={[styles.rankRow, { borderBottomColor: colors.rule }]}>
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
            </View>
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
            <View key={v.name} style={[styles.rankRow, { borderBottomColor: colors.rule }]}>
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
            </View>
          ))
        )}
      </View>
    </ScrollView>
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
  sectionHeader: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
  },
  sectionCount: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
  },
  sectionLabelInline: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  monthTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 22,
    fontWeight: '700',
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
    borderRadius: 6,
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
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '500',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: StyleSheet.hairlineWidth,
    borderRadius: 8,
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
    fontFamily: 'Geist Sans',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  statLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 6,
  },
  card: {
    borderRadius: 12,
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
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '700',
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
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  kindCount: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '500',
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
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
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
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
    borderRadius: 2,
    overflow: 'hidden',
  },
  rankCount: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '600',
    minWidth: 26,
    textAlign: 'right',
  },
});

