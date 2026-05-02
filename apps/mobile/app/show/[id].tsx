/**
 * Show detail — M2 read-only view (C-3).
 *
 * Edit, setlist editor, and the action sheet land in M3 (D-1) and the
 * media grid lands in M4 (D-2). For M2 those slots render stub
 * EmptyStates pointing at the upcoming milestone — they are intentional
 * placeholders, not skeletons.
 *
 * Data: `trpc.shows.detail` returns the show row joined with venue and
 * showPerformers (each carrying its performer). The QueryClient has a
 * SQLite persister attached at app root, so any query that uses the
 * shared client (tRPC's hooks do) is persisted automatically. We
 * piggy-back on CACHE_DEFAULTS so the staleTime / gcTime match the rest
 * of M2's cached queries.
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
  Pencil,
  CheckCircle,
  Trash2,
} from 'lucide-react-native';

import { TopBar } from '../../components/TopBar';
import { KindBadge } from '../../components/KindBadge';
import { StateChip } from '../../components/StateChip';
import { EmptyState } from '../../components/EmptyState';
import { MediaGrid, type MediaGridItem } from '../../components/MediaGrid';
import { Sheet } from '../../components/Sheet';
import { useTheme, type Kind, type ShowState } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { CACHE_DEFAULTS } from '../../lib/cache';
import { useFeedback } from '../../lib/feedback';

// The @showbook/api package isn't a runtime dep of mobile (it's a type-only
// import via `lib/trpc`), so `inferRouterOutputs` from `@trpc/server` isn't
// reachable here without adding a dep. Mirror the subset of `shows.detail`
// fields the screen actually reads — small and stable enough that drift is
// caught quickly when the procedure changes.
interface ShowDetailVenue {
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
  kind: 'concert' | 'theatre' | 'comedy' | 'festival' | 'sports';
  state: 'past' | 'ticketed' | 'watching';
  date: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
  tourName: string | null;
  productionName: string | null;
  notes: string | null;
  venue: ShowDetailVenue;
  showPerformers: ShowDetailShowPerformer[];
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
  // shows.date is a YYYY-MM-DD string. Build a Date in local time so the
  // day-of-week reflects the user's perspective (calendar dates aren't
  // bound to a particular timezone here).
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

export default function ShowDetailScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const showId = typeof params.id === 'string' ? params.id : '';

  const query = trpc.shows.detail.useQuery(
    { showId },
    {
      enabled: showId.length > 0,
      staleTime: CACHE_DEFAULTS.staleTime,
      gcTime: CACHE_DEFAULTS.gcTime,
    },
  );

  const show = query.data as ShowDetail | undefined;

  const back = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/shows'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  const [actionSheetOpen, setActionSheetOpen] = React.useState(false);
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
        >
          <Hero show={show} />
          <Facts show={show} />
          <Lineup show={show} />
          {show.notes ? <Notes notes={show.notes} /> : null}
          <SetlistStub />
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
        />
      ) : null}
    </View>
  );
}

function ShowActionSheet({
  open,
  onClose,
  showId,
  state,
}: {
  open: boolean;
  onClose: () => void;
  showId: string;
  state: ShowState;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const utils = trpc.useUtils();
  const { showToast } = useFeedback();
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const updateState = trpc.shows.updateState.useMutation({
    onSuccess: () => {
      void utils.shows.list.invalidate();
      void utils.shows.detail.invalidate({ showId });
    },
  });
  const remove = trpc.shows.delete.useMutation({
    onSuccess: () => {
      void utils.shows.list.invalidate();
    },
  });

  const closeAndReset = React.useCallback(() => {
    setConfirmingDelete(false);
    onClose();
  }, [onClose]);

  const goEdit = () => {
    closeAndReset();
    router.push(`/show/${showId}/edit`);
  };
  const goSetlist = () => {
    closeAndReset();
    router.push(`/show/${showId}/setlist`);
  };
  const markWatched = async () => {
    if (state === 'past') {
      showToast({ kind: 'info', text: 'Already marked as watched' });
      closeAndReset();
      return;
    }
    try {
      await updateState.mutateAsync({ showId, newState: 'past' });
      showToast({ kind: 'success', text: 'Marked as watched' });
    } catch (err) {
      showToast({ kind: 'error', text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      closeAndReset();
    }
  };
  const doDelete = async () => {
    try {
      await remove.mutateAsync({ showId });
      showToast({ kind: 'success', text: 'Show deleted' });
      closeAndReset();
      router.replace('/(tabs)/shows');
    } catch (err) {
      showToast({ kind: 'error', text: err instanceof Error ? err.message : 'Failed' });
    }
  };

  return (
    <Sheet open={open} onClose={closeAndReset} snapPoints={['44%']}>
      <View style={sheetStyles.body}>
        <ActionRow
          icon={<Pencil size={18} color={colors.ink} strokeWidth={2} />}
          label="Edit show"
          onPress={goEdit}
        />
        <ActionRow
          icon={<ListMusic size={18} color={colors.ink} strokeWidth={2} />}
          label="Edit setlist"
          onPress={goSetlist}
        />
        <ActionRow
          icon={<CheckCircle size={18} color={colors.ink} strokeWidth={2} />}
          label="Mark as watched"
          onPress={() => void markWatched()}
          disabled={state === 'past'}
        />
        <ActionRow
          icon={<Trash2 size={18} color={colors.danger} strokeWidth={2} />}
          label={confirmingDelete ? 'Tap again to confirm' : 'Delete show'}
          onPress={() => {
            if (!confirmingDelete) {
              setConfirmingDelete(true);
              return;
            }
            void doDelete();
          }}
          danger
        />
      </View>
    </Sheet>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  danger = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        sheetStyles.row,
        { borderBottomColor: colors.rule, opacity: disabled ? 0.4 : 1 },
        pressed && { backgroundColor: colors.surface },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
      <Text
        style={[
          sheetStyles.label,
          { color: danger ? colors.danger : colors.ink },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const sheetStyles = StyleSheet.create({
  body: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '500',
  },
});

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function formatTitle(show: ShowDetail): string {
  if (show.kind === 'theatre' && show.productionName) return show.productionName;
  const headliner = show.showPerformers.find((sp) => sp.role === 'headliner');
  return headliner?.performer.name ?? show.productionName ?? 'Show';
}

function Hero({ show }: { show: ShowDetail }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const accent = tokens.kindColor(show.kind as Kind);
  const date = parseShowDate(show.date);
  const headliner = show.showPerformers.find((sp) => sp.role === 'headliner');
  const support = show.showPerformers.filter((sp) => sp.role === 'support');

  const titleText =
    show.kind === 'theatre'
      ? show.productionName ?? headliner?.performer.name ?? 'Untitled'
      : headliner?.performer.name ?? show.productionName ?? 'Untitled';

  return (
    <View style={styles.heroWrap}>
      <View style={styles.chipRow}>
        <KindBadge kind={show.kind as Kind} size="sm" />
        {show.state !== 'past' && <StateChip state={show.state as ShowState} />}
      </View>

      <Text style={[styles.heroTitle, { color: colors.ink }]}>{titleText}</Text>

      {show.tourName ? (
        <Text style={[styles.heroSubtitle, { color: colors.muted }]}>
          {show.tourName}
        </Text>
      ) : null}

      {support.length > 0 ? (
        <Text style={[styles.heroSupport, { color: colors.muted }]} numberOfLines={2}>
          with {support.map((sp) => sp.performer.name).join(', ')}
        </Text>
      ) : null}

      {date ? (
        <View style={[styles.dateBlock, { borderTopColor: colors.ruleStrong }]}>
          <View>
            <Text style={[styles.dateDay, { color: colors.ink }]}>{date.day}</Text>
            <Text style={[styles.dateMonth, { color: accent }]}>
              {date.month} · {date.year}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.dateDow, { color: colors.muted }]}>{date.dow}</Text>
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
}

function Facts({ show }: { show: ShowDetail }): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const accent = tokens.kindColor(show.kind as Kind);

  const rows: FactRow[] = [];
  const venueLabel = [show.venue.name, show.venue.city, show.venue.stateRegion]
    .filter(Boolean)
    .join(' · ');
  if (venueLabel) {
    rows.push({
      key: 'venue',
      label: 'VENUE',
      value: venueLabel,
      icon: <MapPin size={13} color={colors.muted} strokeWidth={1.8} />,
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
      {rows.map((row, i) => (
        <View
          key={row.key}
          style={[
            styles.factRow,
            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.rule },
          ]}
        >
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
        </View>
      ))}
    </View>
  );
}

function Lineup({ show }: { show: ShowDetail }): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;

  // Theatre uses a "Cast" section that lands in M3 alongside the playbill
  // editor. Until then, we still surface any cast rows the API returns so
  // the screen isn't empty for theatre shows that already have data.
  const performers = [...show.showPerformers].sort((a, b) => a.sortOrder - b.sortOrder);
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
          <View
            key={`${sp.performer.id}:${sp.role}`}
            style={[
              styles.lineupRow,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.rule },
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
          </View>
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

function SetlistStub(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <Section title="Setlist" icon={<ListMusic size={13} color={colors.ink} strokeWidth={2} />}>
      <View style={[styles.stubCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
        <EmptyState
          icon={<ListMusic size={32} color={colors.faint} strokeWidth={1.5} />}
          title="Coming in M3"
          subtitle="Setlist editing and setlist.fm sync arrive in the next milestone."
        />
      </View>
    </Section>
  );
}

function isShowPast(show: ShowDetail): boolean {
  // Mirrors the server's `isDatePast` rule: media uploads are gated on
  // the show being in the past. We don't have endDate here so we treat a
  // missing date conservatively as "not past" — matches server behaviour.
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

  // The DTO carries multiple variants (thumb/large/source); the grid wants
  // a single thumbnail uri. Prefer thumb, then source, then anything.
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
// Styles
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
    fontFamily: 'Georgia',
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
