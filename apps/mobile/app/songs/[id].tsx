/**
 * Song detail — per-song "live history" view. Mirrors the web
 * `/songs/[songId]` page: hero title + performer link, stat row
 * (times heard / first heard / last heard / rarity), then a tappable
 * timeline of each show the user heard this song at.
 *
 * Reached from setlist rows on a past show (only past shows carry song
 * IDs in the `shows.songBadges` payload). Predicted setlists don't
 * link here because their songs aren't tied to corpus song rows.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, AlertCircle } from 'lucide-react-native';

import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { QueryBoundary } from '../../components/QueryBoundary';
import { Eyebrow, GradientEmphasis } from '../../components/design-system';
import { useTheme } from '../../lib/theme';
import { RADII } from '../../lib/theme-utils';
import { useAuth } from '../../lib/auth';
import { trpc, type RouterOutput } from '../../lib/trpc';

type UtilsClient = ReturnType<typeof trpc.useUtils>['client'];
type SongDetail = RouterOutput<UtilsClient['songs']['byId']['query']>;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatLongDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const monthIdx = Number(m[2]) - 1;
  return `${MONTHS[monthIdx] ?? '—'} ${Number(m[3])}, ${m[1]}`;
}

function formatDateBlock(iso: string | null | undefined): { month: string; day: string; year: string } {
  if (!iso) return { month: '—', day: '—', year: '' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return { month: '—', day: '—', year: '' };
  return {
    month: MONTHS[Number(m[2]) - 1] ?? '—',
    day: String(Number(m[3])),
    year: m[1],
  };
}

export default function SongDetailScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const songId = typeof params.id === 'string' ? params.id : '';
  const { token } = useAuth();

  const detailQuery = trpc.songs.byId.useQuery(
    { songId },
    { enabled: Boolean(token) && songId.length > 0 },
  );

  const back = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Song" eyebrow="LIVE HISTORY" leading={back} />

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
              title="Couldn't load this song"
              subtitle={(err as { message?: string } | null)?.message ?? 'Try again in a moment.'}
              cta={{ label: 'Retry', onPress: retry }}
            />
          </View>
        )}
      >
        {(data) => <SongView data={data} />}
      </QueryBoundary>
    </View>
  );
}

function SongView({ data }: { data: SongDetail }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { song, timesHeard, firstHeard, lastHeard, timeline, rarity } = data;

  // Pull the last word of the title into the gradient emphasis. For
  // single-word songs the whole title gets the gradient.
  const parts = song.title.trim().split(/\s+/);
  const head = parts.length > 1 ? parts.slice(0, -1).join(' ') + ' ' : '';
  const tail = parts.length > 1 ? (parts[parts.length - 1] as string) : song.title;

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {/* Hero */}
      <View style={styles.hero}>
        <Eyebrow>SONG · YOU HEARD LIVE</Eyebrow>
        <Text style={[styles.title, { color: colors.ink }]} numberOfLines={3}>
          &ldquo;
          {head ? <Text>{head}</Text> : null}
          <GradientEmphasis style={[styles.title, { color: colors.accent }]}>
            {tail}
          </GradientEmphasis>
          &rdquo;
        </Text>
        <Link href={`/artists/${song.performerId}`} asChild>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${song.performerName}`}
            style={({ pressed }) => [styles.performerLink, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.performerName, { color: colors.muted }]}>
              {song.performerName}
            </Text>
          </Pressable>
        </Link>
      </View>

      {/* Stats row */}
      <View style={[styles.statRow, { borderTopColor: colors.rule, borderBottomColor: colors.rule }]}>
        <Stat label="HEARD" value={String(timesHeard)} sub={timesHeard === 1 ? 'time' : 'times'} />
        <Divider />
        <Stat
          label="FIRST"
          value={formatDateBlock(firstHeard?.date ?? null).day}
          sub={formatDateBlock(firstHeard?.date ?? null).month}
          hint={firstHeard ? firstHeard.venueCity ?? firstHeard.venueName : null}
        />
        <Divider />
        <Stat
          label="LAST"
          value={formatDateBlock(lastHeard?.date ?? null).day}
          sub={formatDateBlock(lastHeard?.date ?? null).month}
          hint={lastHeard ? lastHeard.venueCity ?? lastHeard.venueName : null}
        />
        {rarity ? (
          <>
            <Divider />
            <Stat
              label="RARITY"
              value={`${rarity.fractionPct}%`}
              sub={`${rarity.corpusHits}/${rarity.corpusTotal}`}
              hint="last 12mo"
              emphasize
            />
          </>
        ) : null}
      </View>

      {/* Timeline */}
      <View style={styles.timelineWrap}>
        <Eyebrow color={colors.muted}>YOUR TIMELINE · {timeline.length}</Eyebrow>
        {timeline.length === 0 ? (
          <Text style={[styles.empty, { color: colors.muted }]}>
            No appearances on file yet.
          </Text>
        ) : (
          <View style={styles.timeline}>
            {timeline.map((row, idx) =>
              row.showId ? (
                <TimelineRow
                  key={`${row.showId}-${idx}`}
                  showId={row.showId}
                  date={row.date}
                  venueName={row.venueName}
                  venueCity={row.venueCity}
                  isEncore={row.isEncore}
                />
              ) : null,
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function TimelineRow({
  showId,
  date,
  venueName,
  venueCity,
  isEncore,
}: {
  showId: string;
  date: string;
  venueName: string;
  venueCity: string;
  isEncore: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const block = formatDateBlock(date);

  // Direct onPress + router.push instead of <Link asChild> — the asChild
  // wrapper was eating the inner row layout on react-native-web, making
  // the date column wrap below the body. The plain Pressable keeps the
  // flexDirection: 'row' intact on both native and web.
  return (
    <Pressable
      onPress={() => router.push(`/show/${showId}`)}
      accessibilityRole="link"
      accessibilityLabel={`Open show on ${formatLongDate(date)}`}
      style={({ pressed }) => [
        styles.timelineRow,
        {
          backgroundColor: colors.surface,
          borderLeftColor: isEncore ? colors.accent : colors.ruleStrong,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.timelineDate}>
        <Text style={[styles.timelineDay, { color: colors.ink }]}>{block.day}</Text>
        <Text style={[styles.timelineMonth, { color: colors.muted }]}>{block.month}</Text>
        <Text style={[styles.timelineYear, { color: colors.faint }]}>{block.year}</Text>
      </View>
      <View style={styles.timelineBody}>
        <Text style={[styles.timelineVenue, { color: colors.ink }]} numberOfLines={1}>
          {venueName}
        </Text>
        <Text style={[styles.timelineCity, { color: colors.muted }]} numberOfLines={1}>
          {venueCity}
        </Text>
      </View>
      {isEncore ? (
        <View style={[styles.encoreChip, { borderColor: colors.accent }]}>
          <Text style={[styles.encoreChipLabel, { color: colors.accent }]}>ENCORE</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Stat({
  label,
  value,
  sub,
  hint,
  emphasize,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string | null;
  emphasize?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View style={styles.stat}>
      <Text style={[styles.statLabel, { color: colors.faint }]}>{label}</Text>
      <Text style={[styles.statValue, { color: emphasize ? colors.accent : colors.ink }]}>
        {value}
      </Text>
      {sub ? <Text style={[styles.statSub, { color: colors.muted }]}>{sub}</Text> : null}
      {hint ? (
        <Text style={[styles.statHint, { color: colors.faint }]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function Divider(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return <View style={[styles.statDivider, { backgroundColor: colors.rule }]} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 48,
  },
  hero: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 22,
    gap: 10,
  },
  title: {
    fontFamily: 'Fraunces',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.6,
  },
  performerLink: {
    alignSelf: 'flex-start',
  },
  performerName: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '500',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stat: {
    flex: 1,
    paddingHorizontal: 6,
    gap: 2,
    minWidth: 0,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  statLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 9.5,
    letterSpacing: 1.05,
    textTransform: 'uppercase',
  },
  statValue: {
    fontFamily: 'Geist Sans',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    lineHeight: 26,
  },
  statSub: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  statHint: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    marginTop: 2,
  },
  timelineWrap: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 12,
  },
  empty: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    lineHeight: 18,
  },
  timeline: {
    gap: 8,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingRight: 12,
    borderLeftWidth: 2,
    borderRadius: RADII.md,
  },
  timelineDate: {
    width: 64,
    paddingLeft: 12,
    paddingRight: 4,
    alignItems: 'center',
    flexShrink: 0,
  },
  timelineDay: {
    fontFamily: 'Geist Sans',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  timelineMonth: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    letterSpacing: 0.6,
    marginTop: 1,
  },
  timelineYear: {
    fontFamily: 'Geist Mono',
    fontSize: 9.5,
    letterSpacing: 0.6,
    marginTop: 1,
  },
  timelineBody: {
    flex: 1,
    minWidth: 0,
  },
  timelineVenue: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
  },
  timelineCity: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    marginTop: 2,
  },
  encoreChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  encoreChipLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
});
