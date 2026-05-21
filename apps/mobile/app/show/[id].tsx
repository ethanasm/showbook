/**
 * Show detail — Phase 10 brings the 4-tab redesign behind the
 * `SetlistIntelMobileV2` feature flag. ON renders the new
 * `ShowDetailTabsView`; OFF renders the legacy vertical stack
 * (`LegacyShowDetailScreen` below) so the smoke test can compare side
 * by side before flip.
 *
 * Data: `trpc.shows.detail` returns the show row joined with venue and
 * showPerformers (each carrying its performer). The QueryClient has a
 * SQLite persister attached at app root, so any query that uses the
 * shared client (tRPC's hooks do) is persisted automatically. We
 * piggy-back on CACHE_DEFAULTS so the staleTime / gcTime match the rest
 * of the cached queries.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft,
  MapPin,
  Ticket,
  Tag,
  Users,
  Music,
  Image as ImageIcon,
  ListMusic,
  AlertCircle,
  MoreHorizontal,
  Sparkles,
} from 'lucide-react-native';
import type { PerformerSetlist } from '@showbook/shared';
import { formatVenueLabel, getHeadliner, isFeatureOn } from '@showbook/shared';

import { TopBar } from '../../components/TopBar';
import { KindBadge } from '../../components/KindBadge';
import { StateChip } from '../../components/StateChip';
import { EmptyState } from '../../components/EmptyState';
import { MediaGrid, type MediaGridItem } from '../../components/MediaGrid';
import { ShowActionSheet } from '../../components/ShowActionSheet';
import { MarkTicketedSheet } from '../../components/MarkTicketedSheet';
import { useThemedRefreshControl } from '../../components/PullToRefresh';
import {
  ShowDetailTabsView,
  type ShowDetail as TabbedShowDetail,
} from '../../components/show-tabs/ShowDetailTabsView';
import { useTheme, type Kind, type ShowState } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { CACHE_DEFAULTS } from '../../lib/cache';

interface ShowDetailVenue {
  id: string;
  name: string;
  city: string;
  stateRegion: string | null;
}
interface ShowDetailPerformer {
  id: string;
  name: string;
}
interface ShowDetailShowPerformer {
  role: 'headliner' | 'support' | 'cast';
  sortOrder: number;
  characterName: string | null;
  performer: ShowDetailPerformer;
}
interface ShowDetail {
  id: string;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival' | 'sports' | 'film' | 'unknown';
  state: 'past' | 'ticketed' | 'watching';
  date: string | null;
  endDate: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
  tourName: string | null;
  productionName: string | null;
  notes: string | null;
  ticketUrl: string | null;
  venue: ShowDetailVenue;
  showPerformers: ShowDetailShowPerformer[];
  setlists: Record<string, PerformerSetlist> | null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface DateParts {
  month: string;
  day: string;
  year: string;
  dow: string;
}

function parseShowDate(date: string | null | undefined): DateParts | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, monthIdx, day);
  return {
    month: MONTHS[monthIdx] ?? '',
    day: String(day),
    year: String(year),
    dow: DOWS[d.getDay()] ?? '',
  };
}

interface DateRange {
  dayLabel: string;
  monthLabel: string;
  trailing: string;
}

function buildDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): DateRange | null {
  const startParts = parseShowDate(start);
  if (!startParts) return null;
  const endParts = end && end !== start ? parseShowDate(end) : null;
  if (!endParts) {
    return {
      dayLabel: startParts.day,
      monthLabel: `${startParts.month} · ${startParts.year}`,
      trailing: startParts.dow,
    };
  }
  const sameMonth = startParts.month === endParts.month && startParts.year === endParts.year;
  const dayLabel = sameMonth
    ? `${startParts.day}–${endParts.day}`
    : `${startParts.day}–${endParts.month} ${endParts.day}`;
  const monthLabel = sameMonth
    ? `${startParts.month} · ${startParts.year}`
    : startParts.year === endParts.year
      ? `${startParts.month} · ${startParts.year}`
      : `${startParts.month} ${startParts.year} – ${endParts.month} ${endParts.year}`;
  const startMs = new Date(
    Number(startParts.year),
    MONTHS.indexOf(startParts.month),
    Number(startParts.day),
  ).getTime();
  const endMs = new Date(
    Number(endParts.year),
    MONTHS.indexOf(endParts.month),
    Number(endParts.day),
  ).getTime();
  const nights = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
  return {
    dayLabel,
    monthLabel,
    trailing: `${nights} DAYS`,
  };
}

export interface ShowDetailScreenProps {
  /** Override the route param — used by the iPad three-pane layout. */
  showIdProp?: string;
}

export default function ShowDetailScreen(
  props: ShowDetailScreenProps = {},
): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const paramId = typeof params.id === 'string' ? params.id : '';
  const showId = props.showIdProp ?? paramId;

  const query = trpc.shows.detail.useQuery(
    { showId },
    {
      enabled: showId.length > 0,
      staleTime: CACHE_DEFAULTS.staleTime,
      gcTime: CACHE_DEFAULTS.gcTime,
    },
  );

  const show = query.data as ShowDetail | undefined;
  const tabbedEnabled = isFeatureOn('SetlistIntelMobileV2');
  const refreshControl = useThemedRefreshControl(
    query.isFetching && !query.isLoading,
    () => {
      void query.refetch();
    },
  );

  const back = (
    <Pressable
      onPress={() =>
        router.canGoBack() ? router.back() : router.replace('/(tabs)/shows')
      }
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  const [actionSheetOpen, setActionSheetOpen] = React.useState(false);
  const [markTicketedOpen, setMarkTicketedOpen] = React.useState(false);
  const moreAction = show ? (
    <Pressable
      onPress={() => setActionSheetOpen(true)}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="More actions"
    >
      <MoreHorizontal size={22} color={colors.ink} strokeWidth={2} />
    </Pressable>
  ) : undefined;

  // ──────────────────────────────────────────────────────────────────
  // Tabbed layout (Phase 10) — feature-flagged. Reuses the same shows.
  // detail payload so the swap is invisible to the data layer.
  // ──────────────────────────────────────────────────────────────────
  if (tabbedEnabled) {
    // The full-bleed hero owns its own chrome (back + more buttons floating
    // over the photo), so we skip the screen-level TopBar and let the hero
    // bleed under the status bar. Loading / error states still need the
    // top safe-area inset so the spinner doesn't render under the notch.
    const onBack = (): void => {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/shows');
    };
    return (
      <View
        style={{ flex: 1, backgroundColor: colors.bg }}
        testID="show-detail-tabs-root"
      >
        {query.isLoading ? (
          <View style={[styles.center, { paddingTop: insets.top }]}>
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : null}
        {query.isError && !show ? (
          <View style={[styles.center, { paddingTop: insets.top }]}>
            <EmptyState
              icon={<AlertCircle size={40} color={colors.faint} strokeWidth={1.5} />}
              title="Couldn't load show"
              subtitle={query.error?.message ?? 'Try again in a moment.'}
              cta={{ label: 'Retry', onPress: () => void query.refetch() }}
            />
          </View>
        ) : null}
        {show ? (
          <ShowDetailTabsView
            show={show as TabbedShowDetail}
            onBack={onBack}
            onMore={() => setActionSheetOpen(true)}
            initialTab={
              typeof params.tab === 'string'
                ? (params.tab as 'overview' | 'setlist' | 'media' | 'notes')
                : undefined
            }
          />
        ) : null}
        {show ? (
          <ShowActionSheet
            open={actionSheetOpen}
            onClose={() => setActionSheetOpen(false)}
            showId={show.id}
            state={show.state as ShowState}
            popAfterDelete
            onMarkTicketed={() => setMarkTicketedOpen(true)}
          />
        ) : null}
        {show ? (
          <MarkTicketedSheet
            open={markTicketedOpen}
            onClose={() => setMarkTicketedOpen(false)}
            showId={show.id}
            initialSeat={show.seat}
            initialPrice={show.pricePaid}
            initialTicketCount={show.ticketCount}
          />
        ) : null}
      </View>
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Legacy vertical-stack layout (pre-Phase-10). Default while the
  // SetlistIntelMobileV2 flag is OFF.
  // ──────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title={show ? formatTitle(show) : 'Show'}
        eyebrow={show?.kind ? show.kind.toUpperCase() : undefined}
        leading={back}
        rightAction={moreAction}
      />

      {query.isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.muted} />
        </View>
      )}

      {query.isError && !show && (
        <View style={styles.center}>
          <EmptyState
            icon={<AlertCircle size={40} color={colors.faint} strokeWidth={1.5} />}
            title="Couldn't load show"
            subtitle={query.error?.message ?? 'Try again in a moment.'}
            cta={{ label: 'Retry', onPress: () => void query.refetch() }}
          />
        </View>
      )}

      {show && (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        >
          <Hero show={show} />
          <Facts show={show} />
          <Lineup show={show} />
          {show.notes ? <Notes notes={show.notes} /> : null}
          <Setlists show={show} />
          <Photos showId={show.id} canUpload={isShowPast(show)} />
          <View style={styles.endRule}>
            <Text style={[styles.endText, { color: colors.faint }]}>— END —</Text>
          </View>
        </ScrollView>
      )}

      {show ? (
        <ShowActionSheet
          open={actionSheetOpen}
          onClose={() => setActionSheetOpen(false)}
          showId={show.id}
          state={show.state as ShowState}
          popAfterDelete
          onMarkTicketed={() => setMarkTicketedOpen(true)}
        />
      ) : null}
      {show ? (
        <MarkTicketedSheet
          open={markTicketedOpen}
          onClose={() => setMarkTicketedOpen(false)}
          showId={show.id}
          initialSeat={show.seat}
          initialPrice={show.pricePaid}
          initialTicketCount={show.ticketCount}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-sections (legacy layout)
// ---------------------------------------------------------------------------

function formatTitle(show: ShowDetail): string {
  const label = getHeadliner(show);
  return label === 'Unknown Artist' ? 'Show' : label;
}

function Hero({ show }: { show: ShowDetail }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const accent = tokens.kindColor(show.kind as Kind);
  const date = buildDateRange(show.date, show.endDate);
  const headliner = show.showPerformers.find((sp) => sp.role === 'headliner');
  const support = show.showPerformers.filter((sp) => sp.role === 'support');

  const titleText =
    show.kind === 'theatre'
      ? show.productionName ?? headliner?.performer.name ?? 'Untitled'
      : headliner?.performer.name ?? show.productionName ?? 'Untitled';

  // Headliner becomes a link to /artists/[id] when it's an actual
  // performer (concerts/comedy/festivals); theatre productions render
  // the production name instead and have no headliner link.
  const titleLinkPerformerId =
    show.kind === 'theatre' ? null : headliner?.performer.id ?? null;

  return (
    <View style={styles.heroWrap}>
      <View style={styles.chipRow}>
        <KindBadge kind={show.kind as Kind} size="sm" />
        {show.state !== 'past' && <StateChip state={show.state as ShowState} />}
      </View>

      {titleLinkPerformerId ? (
        <Pressable
          onPress={() => router.push(`/artists/${titleLinkPerformerId}`)}
          accessibilityRole="link"
          accessibilityLabel={`Open ${titleText}`}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.heroTitle, { color: colors.ink }]}>{titleText}</Text>
        </Pressable>
      ) : (
        <Text style={[styles.heroTitle, { color: colors.ink }]}>{titleText}</Text>
      )}

      {show.tourName ? (
        <Text style={[styles.heroSubtitle, { color: colors.muted }]}>
          {show.tourName}
        </Text>
      ) : null}

      {support.length > 0 ? (
        <Text style={[styles.heroSupport, { color: colors.muted }]} numberOfLines={2}>
          {'with '}
          {support.map((sp, i) => (
            <Text
              key={sp.performer.id}
              onPress={() => router.push(`/artists/${sp.performer.id}`)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${sp.performer.name}`}
              style={{ color: colors.muted }}
            >
              {sp.performer.name}
              {i < support.length - 1 ? ', ' : ''}
            </Text>
          ))}
        </Text>
      ) : null}

      {date ? (
        <View style={[styles.dateBlock, { borderTopColor: colors.ruleStrong }]}>
          <View>
            <Text style={[styles.dateDay, { color: colors.ink }]}>{date.dayLabel}</Text>
            <Text style={[styles.dateMonth, { color: accent }]}>{date.monthLabel}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.dateDow, { color: colors.muted }]}>{date.trailing}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

interface FactRow {
  key: string;
  label: string;
  value: string;
  icon: React.ReactNode;
  onPress?: () => void;
}

function Facts({ show }: { show: ShowDetail }): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const accent = tokens.kindColor(show.kind as Kind);

  const rows: FactRow[] = [];
  const venueLabel = formatVenueLabel(show.venue);
  if (venueLabel) {
    rows.push({
      key: 'venue',
      label: 'VENUE',
      value: venueLabel,
      icon: <MapPin size={13} color={colors.muted} strokeWidth={1.8} />,
      onPress: () => router.push(`/venues/${show.venue.id}`),
    });
  }
  if (show.seat) {
    rows.push({
      key: 'seat',
      label: 'SEAT',
      value: show.seat,
      icon: <Ticket size={13} color={colors.muted} strokeWidth={1.8} />,
    });
  }
  if (show.pricePaid) {
    const count = show.ticketCount ?? 1;
    const meta = count > 1 ? ` · ${count} tickets` : '';
    rows.push({
      key: 'price',
      label: 'PRICE',
      value: `$${show.pricePaid}${meta}`,
      icon: <Tag size={13} color={colors.muted} strokeWidth={1.8} />,
    });
  }
  if (show.kind !== 'theatre' && show.productionName) {
    rows.push({
      key: 'production',
      label: 'PROD',
      value: show.productionName,
      icon: <Music size={13} color={colors.muted} strokeWidth={1.8} />,
    });
  }

  if (rows.length === 0) return null;

  return (
    <View
      style={[
        styles.factCard,
        { backgroundColor: colors.surface, borderLeftColor: accent },
      ]}
    >
      {rows.map((row, i) => {
        const rowStyle = [
          styles.factRow,
          i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.rule },
        ];
        const rowContent = (
          <>
            <Text style={[styles.factLabel, { color: colors.faint }]}>{row.label}</Text>
            <View style={styles.factValueWrap}>
              {row.icon}
              <Text
                style={[styles.factValue, { color: colors.ink }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {row.value}
              </Text>
            </View>
          </>
        );
        if (row.onPress) {
          return (
            <Pressable
              key={row.key}
              onPress={row.onPress}
              accessibilityRole="link"
              accessibilityLabel={`${row.label} ${row.value}`}
              style={({ pressed }) => [...rowStyle, pressed && { opacity: 0.7 }]}
            >
              {rowContent}
            </Pressable>
          );
        }
        return (
          <View key={row.key} style={rowStyle}>
            {rowContent}
          </View>
        );
      })}
    </View>
  );
}

function Lineup({ show }: { show: ShowDetail }): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();

  // Festival shows used to ship with a phantom headliner performer
  // whose name mirrored production_name. Migration 0052 drops those
  // rows server-side; this filter keeps the lineup card clean if the
  // app is reading from a stale cache (or for festivals that somehow
  // re-acquire the row before the migration lands).
  const productionNorm =
    show.kind === 'festival' && show.productionName
      ? show.productionName.trim().toLowerCase()
      : null;
  const performers = [...show.showPerformers]
    .filter((sp) =>
      productionNorm === null
        ? true
        : sp.performer.name.trim().toLowerCase() !== productionNorm,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (performers.length === 0) return null;

  const isTheatre = show.kind === 'theatre';
  const title = isTheatre ? `Cast · ${performers.length}` : `Lineup · ${performers.length}`;

  return (
    <Section
      title={title}
      icon={
        isTheatre ? (
          <Users size={13} color={colors.ink} strokeWidth={2} />
        ) : (
          <Music size={13} color={colors.ink} strokeWidth={2} />
        )
      }
    >
      <View style={[styles.lineupCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
        {performers.map((sp, i) => (
          <Pressable
            key={`${sp.performer.id}:${sp.role}`}
            onPress={() => router.push(`/artists/${sp.performer.id}`)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${sp.performer.name}`}
            style={({ pressed }) => [
              styles.lineupRow,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.rule },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.lineupRole, { color: colors.faint }]}>
              {(sp.characterName ? sp.characterName : sp.role).toUpperCase()}
            </Text>
            <Text
              style={[styles.lineupName, { color: colors.ink }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {sp.performer.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </Section>
  );
}

function Notes({ notes }: { notes: string }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <Section title="Notes" icon={null}>
      <View style={[styles.notesCard, { backgroundColor: colors.surface, borderLeftColor: colors.ruleStrong }]}>
        <Text style={[styles.notesText, { color: colors.ink }]}>{notes}</Text>
      </View>
    </Section>
  );
}

function Setlists({ show }: { show: ShowDetail }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();

  const performerById = React.useMemo(() => {
    const map = new Map<string, { name: string }>();
    for (const sp of show.showPerformers) {
      map.set(sp.performer.id, { name: sp.performer.name });
    }
    return map;
  }, [show.showPerformers]);

  const entries = React.useMemo(() => {
    const out: { performerId: string; name: string; sl: PerformerSetlist }[] = [];
    if (!show.setlists) return out;
    for (const [performerId, sl] of Object.entries(show.setlists)) {
      const meta = performerById.get(performerId);
      if (!meta) continue;
      const hasAnySong = sl.sections.some((sec) => sec.songs.length > 0);
      if (!hasAnySong) continue;
      out.push({ performerId, name: meta.name, sl });
    }
    return out;
  }, [show.setlists, performerById]);

  const goEdit = (performerId?: string) => {
    const params = performerId ? `?performerId=${encodeURIComponent(performerId)}` : '';
    router.push(`/show/${show.id}/setlist${params}`);
  };

  return (
    <Section title="Setlist" icon={<ListMusic size={13} color={colors.ink} strokeWidth={2} />}>
      {entries.length === 0 ? (
        <Pressable
          onPress={() => goEdit()}
          accessibilityRole="button"
          accessibilityLabel="Add setlist"
          style={({ pressed }) => [
            styles.stubCard,
            { backgroundColor: colors.surface, borderColor: colors.rule },
            pressed && { opacity: 0.85 },
          ]}
        >
          <EmptyState
            icon={<ListMusic size={32} color={colors.faint} strokeWidth={1.5} />}
            title="No setlist yet"
            subtitle="Tap to add the songs you heard, then drag to reorder."
          />
        </Pressable>
      ) : (
        entries.map(({ performerId, name, sl }) => (
          <Pressable
            key={performerId}
            onPress={() => goEdit(performerId)}
            accessibilityRole="button"
            accessibilityLabel={`Edit setlist for ${name}`}
            style={({ pressed }) => [
              styles.setlistCard,
              { backgroundColor: colors.surface, borderColor: colors.rule },
              pressed && { opacity: 0.9 },
            ]}
          >
            {entries.length > 1 ? (
              <Text style={[styles.setlistPerformer, { color: colors.muted }]}>
                {name.toUpperCase()}
              </Text>
            ) : null}
            {sl.sections.map((sec, sIdx) => (
              <View key={`${sIdx}:${sec.kind}`} style={styles.setlistSection}>
                {sec.kind === 'encore' ? (
                  <View style={styles.encoreLabelRow}>
                    <Sparkles size={11} color={colors.accent} strokeWidth={2} />
                    <Text
                      style={[styles.encoreLabel, { color: colors.accent }]}
                    >
                      ENCORE
                    </Text>
                  </View>
                ) : null}
                {sec.songs.map((song, songIdx) => (
                  <View key={`${sIdx}:${songIdx}`} style={styles.setlistSongRow}>
                    <Text style={[styles.setlistTrackNum, { color: colors.faint }]}>
                      {songIdx + 1}
                    </Text>
                    <Text
                      style={[styles.setlistSongTitle, { color: colors.ink }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {song.title || 'Untitled'}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </Pressable>
        ))
      )}
    </Section>
  );
}

function isShowPast(show: ShowDetail): boolean {
  if (!show.date) return false;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(today.getDate()).padStart(2, '0')}`;
  return show.date < todayStr;
}

function Photos({
  showId,
  canUpload,
}: {
  showId: string;
  canUpload: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const query = trpc.media.listForShow.useQuery(
    { showId },
    {
      staleTime: CACHE_DEFAULTS.staleTime,
      gcTime: CACHE_DEFAULTS.gcTime,
    },
  );

  const items: MediaGridItem[] = (query.data ?? []).map((dto) => {
    const urls = (dto.urls ?? {}) as Record<string, string>;
    const thumbnailUri = urls.thumb ?? urls.large ?? urls.source ?? Object.values(urls)[0] ?? '';
    return {
      id: dto.id,
      thumbnailUri,
      caption: dto.caption,
      tagCount: dto.performerIds?.length ?? 0,
    };
  });

  return (
    <Section title="Photos" icon={<ImageIcon size={13} color={colors.ink} strokeWidth={2} />}>
      <MediaGrid
        items={items}
        showId={showId}
        canUpload={canUpload}
        loading={query.isLoading}
      />
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

// ---------------------------------------------------------------------------
// Styles (legacy)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroWrap: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 22,
    gap: 8,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  heroTitle: {
    fontFamily: 'Fraunces',
    fontSize: 30,
    fontWeight: '600',
    lineHeight: 32,
    letterSpacing: -0.6,
    marginTop: 6,
  },
  heroSubtitle: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 20,
  },
  heroSupport: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 19,
  },
  dateBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dateDay: {
    fontFamily: 'Geist Sans',
    fontSize: 56,
    fontWeight: '500',
    lineHeight: 56,
    letterSpacing: -2.4,
  },
  dateMonth: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 11 * 0.1,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  dateDow: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 11 * 0.06,
    textTransform: 'uppercase',
    paddingBottom: 4,
  },
  factCard: {
    marginHorizontal: 20,
    borderLeftWidth: 2,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  factLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1,
    textTransform: 'uppercase',
    width: 56,
  },
  factValueWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
  },
  factValue: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 13.5,
    fontWeight: '400',
    lineHeight: 18,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 26,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 11 * 0.08,
    textTransform: 'uppercase',
  },
  lineupCard: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  lineupRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 2,
  },
  lineupRole: {
    fontFamily: 'Geist Sans',
    fontSize: 9.5,
    fontWeight: '500',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  lineupName: {
    fontFamily: 'Geist Sans',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  notesCard: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderLeftWidth: 2,
  },
  notesText: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 21,
  },
  stubCard: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  setlistCard: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
    marginBottom: 8,
  },
  setlistPerformer: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 4,
  },
  setlistSection: {
    gap: 4,
  },
  setlistSongRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  setlistTrackNum: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    width: 22,
    textAlign: 'right',
    letterSpacing: 0.4,
  },
  setlistSongTitle: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 13.5,
    fontWeight: '500',
  },
  encoreLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingTop: 4,
    paddingBottom: 2,
  },
  encoreLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
  },
  endRule: {
    paddingTop: 30,
    paddingBottom: 14,
    alignItems: 'center',
  },
  endText: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    letterSpacing: 1.4,
  },
});
