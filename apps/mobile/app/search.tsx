/**
 * Search — omnisearch screen.
 *
 * Pushed from Discover, Artists list, Venues list, and (optionally) the
 * Me tab. The screen takes a query, debounces it 250 ms via
 * `useDebouncedValue` (Wave A), calls `search.global`, and groups
 * results by entity type.
 *
 * No server hit fires while the query is empty (`isEmptyQuery` returns
 * `true`), which is verified in the helper unit tests.
 *
 * Pure helpers (group / highlight / empty-query check) live in
 * `apps/mobile/lib/search.ts` so they are testable without React
 * Native; this file is the thin RN wrapper around them.
 */

import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter, Link, Stack } from 'expo-router';
import {
  ChevronLeft,
  Search as SearchIcon,
  X,
  Music,
  Users,
  MapPin,
  CalendarPlus,
  UserPlus,
  Plus,
  Check,
  ChevronRight,
} from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { EmptyState } from '../components/EmptyState';
import { OfflineEmptyState } from '../components/OfflineEmptyState';
import { KindBadge } from '../components/KindBadge';
import { useTheme, type Kind } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { useAuth } from '@/lib/auth';
import { useNetwork } from '@/lib/network';
import { useFeedback } from '@/lib/feedback';
import { trpc } from '@/lib/trpc';
import { invalidateDiscoverFeeds } from '@/lib/cache';
import { useDebouncedValue } from '@showbook/shared/hooks';
import {
  dedupeDiscoverArtists,
  dedupeDiscoverVenues,
  extractHighlight,
  futureShowToFormParams,
  groupResults,
  isEmptyQuery,
  type DiscoverArtist,
  type DiscoverVenue,
  type FutureShow,
  type GroupedSearchResults,
  type RawGlobalResults,
  type SearchPerformer,
  type SearchShow,
  type SearchVenue,
} from '@/lib/search';

const SEARCH_DEBOUNCE_MS = 250;

// Hoisted so the `options` reference passed to `<Stack.Screen>` is
// stable across renders. See the same constant in `apps/mobile/app/add/form.tsx`
// for the iOS re-mount cascade this prevents.
const SCREEN_OPTIONS = { presentation: 'modal', gestureEnabled: true } as const;

export default function SearchScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { token } = useAuth();
  const network = useNetwork();

  const [query, setQuery] = React.useState('');
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const trimmed = debounced.trim();
  const empty = isEmptyQuery(trimmed);

  const searchQuery = trpc.search.global.useQuery(
    { query: trimmed },
    {
      // Skip the request when offline — `search.global` has no cached
      // fallback and would only generate a confusing spinner.
      enabled: Boolean(token) && !empty && network.online,
      staleTime: 30_000,
    },
  );

  const grouped: GroupedSearchResults = React.useMemo(
    () => groupResults((searchQuery.data as RawGlobalResults | undefined) ?? null),
    [searchQuery.data],
  );

  // Upcoming Ticketmaster shows — its own query (and section) so the
  // user's logbook results render without waiting on the TM round-trip.
  const futureShowsQuery = trpc.search.futureShows.useQuery(
    { query: trimmed },
    {
      enabled:
        Boolean(token) && !empty && network.online && trimmed.length >= 2,
      staleTime: 30_000,
    },
  );
  const futureShows = futureShowsQuery.data ?? [];

  // ── Discoverable (not-yet-followed) results ──────────────────────────
  // The same catalog queries the Discover follow sheets use:
  //   - `discover.searchArtists` (Ticketmaster attractions)
  //   - `venues.search` (venue catalog)
  // Gated to ≥2 chars (like Future shows) and online-only — neither has a
  // cached fallback. Deduped against the user's own results and capped so
  // the discoverable rows stay a short, decorated tail under the log
  // sections rather than crowding them.
  const discoverEnabled =
    Boolean(token) && !empty && network.online && trimmed.length >= 2;

  const discoverArtistsQuery = trpc.discover.searchArtists.useQuery(
    { keyword: trimmed },
    { enabled: discoverEnabled, staleTime: 60_000 },
  );
  const discoverVenuesQuery = trpc.venues.search.useQuery(
    { query: trimmed },
    { enabled: discoverEnabled, staleTime: 60_000 },
  );

  const discoverArtists = React.useMemo(
    () => dedupeDiscoverArtists(discoverArtistsQuery.data, grouped.artists.items),
    [discoverArtistsQuery.data, grouped.artists.items],
  );
  const discoverVenues = React.useMemo(
    () => dedupeDiscoverVenues(discoverVenuesQuery.data, grouped.venues.items),
    [discoverVenuesQuery.data, grouped.venues.items],
  );

  // Inline artist follow — mirrors the Discover follow-artist sheet
  // (`performers.followAttraction`). Online-only, no outbox: search is
  // already gated behind a live connection.
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();
  const [followedArtistIds, setFollowedArtistIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  const followAttraction = trpc.performers.followAttraction.useMutation({
    onSuccess: (_data, vars) => {
      void utils.performers.list.invalidate();
      invalidateDiscoverFeeds(queryClient);
      setFollowedArtistIds((prev) => {
        const next = new Set(prev);
        next.add(vars.tmAttractionId);
        return next;
      });
      showToast({ kind: 'success', text: `Following ${vars.name}` });
    },
    onError: (err) => {
      showToast({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not follow artist',
      });
    },
  });

  const onFollowArtist = React.useCallback(
    (artist: DiscoverArtist) => {
      if (followAttraction.isPending) return;
      followAttraction.mutate({
        tmAttractionId: artist.id,
        name: artist.name,
        imageUrl: artist.imageUrl ?? undefined,
        musicbrainzId: artist.mbid ?? undefined,
      });
    },
    [followAttraction],
  );

  const pendingFollowId = followAttraction.isPending
    ? followAttraction.variables?.tmAttractionId
    : undefined;

  const back = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Close search"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
    <ScreenWrapper title="Search" eyebrow="SHOWS · ARTISTS · VENUES" leading={back}>
      <View
        style={[
          styles.searchBar,
          { backgroundColor: colors.surface, borderColor: colors.rule },
        ]}
      >
        <SearchIcon size={16} color={colors.muted} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Bleachers, Bowery, 2024…"
          placeholderTextColor={colors.faint}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={[styles.searchInput, { color: colors.ink }]}
          accessibilityLabel="Search query"
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <X size={16} color={colors.muted} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {!network.online ? (
          <OfflineEmptyState
            title="Search is offline-only"
            subtitle="Search needs a live connection. Try again when you're back online."
          />
        ) : empty ? (
          <EmptyState
            icon={<SearchIcon size={40} color={colors.faint} strokeWidth={1.5} />}
            title="Search everything"
            subtitle="Find shows, artists, and venues in your log — plus new ones to follow."
          />
        ) : searchQuery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : searchQuery.isError && !searchQuery.data ? (
          <EmptyState
            title="Search failed"
            subtitle={
              searchQuery.error instanceof Error
                ? searchQuery.error.message
                : 'Tap to try again.'
            }
            cta={{
              label: 'Try again',
              onPress: () => void searchQuery.refetch(),
            }}
          />
        ) : grouped.total === 0 &&
          futureShows.length === 0 &&
          discoverArtists.length === 0 &&
          discoverVenues.length === 0 &&
          !futureShowsQuery.isLoading &&
          !discoverArtistsQuery.isLoading &&
          !discoverVenuesQuery.isLoading ? (
          <EmptyState
            icon={<SearchIcon size={40} color={colors.faint} strokeWidth={1.5} />}
            title="No matches"
            subtitle={`Nothing matches "${trimmed}". Try a different spelling or fewer words.`}
          />
        ) : (
          <>
            {grouped.shows.count > 0 ? (
              <Group
                title="Shows"
                count={grouped.shows.count}
                icon={<Music size={13} color={colors.ink} strokeWidth={2} />}
              >
                {grouped.shows.items.map((s) => (
                  <ShowResultRow key={s.id} show={s} query={trimmed} />
                ))}
              </Group>
            ) : null}
            {grouped.artists.count > 0 ? (
              <Group
                title="Artists"
                count={grouped.artists.count}
                icon={<Users size={13} color={colors.ink} strokeWidth={2} />}
              >
                {grouped.artists.items.map((p) => (
                  <ArtistResultRow key={p.id} performer={p} query={trimmed} />
                ))}
              </Group>
            ) : null}
            {grouped.venues.count > 0 ? (
              <Group
                title="Venues"
                count={grouped.venues.count}
                icon={<MapPin size={13} color={colors.ink} strokeWidth={2} />}
              >
                {grouped.venues.items.map((v) => (
                  <VenueResultRow key={v.id} venue={v} query={trimmed} />
                ))}
              </Group>
            ) : null}
            {futureShows.length > 0 ? (
              <Group
                title="Future shows"
                count={futureShows.length}
                icon={<CalendarPlus size={13} color={colors.ink} strokeWidth={2} />}
              >
                {futureShows.map((s) => (
                  <FutureShowResultRow key={s.tmEventId} show={s} query={trimmed} />
                ))}
              </Group>
            ) : null}
            {discoverArtists.length > 0 ? (
              <Group
                title="Artists to follow"
                count={discoverArtists.length}
                icon={<UserPlus size={13} color={colors.ink} strokeWidth={2} />}
              >
                {discoverArtists.map((a) => (
                  <DiscoverArtistResultRow
                    key={a.id}
                    artist={a}
                    query={trimmed}
                    followed={followedArtistIds.has(a.id)}
                    pending={pendingFollowId === a.id}
                    onFollow={() => onFollowArtist(a)}
                  />
                ))}
              </Group>
            ) : null}
            {discoverVenues.length > 0 ? (
              <Group
                title="Venues to follow"
                count={discoverVenues.length}
                icon={<MapPin size={13} color={colors.ink} strokeWidth={2} />}
              >
                {discoverVenues.map((v) => (
                  <DiscoverVenueResultRow key={v.id} venue={v} query={trimmed} />
                ))}
              </Group>
            ) : null}
          </>
        )}
      </ScrollView>
    </ScreenWrapper>
    </>
  );
}

function Group({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        {icon}
        <Text style={[styles.groupTitle, { color: colors.ink }]}>
          {title.toUpperCase()} · {count}
        </Text>
      </View>
      <View style={styles.groupList}>{children}</View>
    </View>
  );
}

function ShowResultRow({ show, query }: { show: SearchShow; query: string }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const accent = tokens.kindColor(show.kind as Kind);
  const dateLabel = show.date ?? '—';
  const venueLabel = [show.venueName, show.venueCity].filter(Boolean).join(' · ');

  return (
    <Link href={`/show/${show.id}`} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: colors.surface, borderLeftColor: accent },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.rowBadgeRow}>
          <KindBadge kind={show.kind as Kind} size="sm" />
          <Text style={[styles.rowMeta, { color: colors.muted }]}>{dateLabel}</Text>
        </View>
        <HighlightedText
          text={show.title}
          query={query}
          style={[styles.rowTitle, { color: colors.ink }]}
        />
        <Text style={[styles.rowSubtitle, { color: colors.muted }]} numberOfLines={1}>
          {venueLabel}
        </Text>
      </Pressable>
    </Link>
  );
}

function ArtistResultRow({
  performer,
  query,
}: {
  performer: SearchPerformer;
  query: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const initial = performer.name.trim()[0]?.toUpperCase() ?? '?';

  return (
    <Link href={`/artists/${performer.id}`} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          styles.rowFlex,
          { backgroundColor: colors.surface },
          pressed && styles.pressed,
        ]}
      >
        <View
          style={[
            styles.avatar,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
          ]}
        >
          {performer.imageUrl ? (
            <Image source={{ uri: performer.imageUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={[styles.avatarInitial, { color: colors.muted }]}>{initial}</Text>
          )}
        </View>
        <View style={styles.rowContent}>
          <HighlightedText
            text={performer.name}
            query={query}
            style={[styles.rowTitle, { color: colors.ink }]}
          />
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
            {performer.showCount} show{performer.showCount === 1 ? '' : 's'}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

function VenueResultRow({ venue, query }: { venue: SearchVenue; query: string }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <Link href={`/venues/${venue.id}`} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          styles.rowFlex,
          { backgroundColor: colors.surface },
          pressed && styles.pressed,
        ]}
      >
        <View
          style={[
            styles.venueIcon,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
          ]}
        >
          <MapPin size={18} color={colors.muted} strokeWidth={2} />
        </View>
        <View style={styles.rowContent}>
          <HighlightedText
            text={venue.name}
            query={query}
            style={[styles.rowTitle, { color: colors.ink }]}
          />
          <Text style={[styles.rowSubtitle, { color: colors.muted }]} numberOfLines={1}>
            {venue.city ?? 'Location unknown'} · {venue.showCount} show
            {venue.showCount === 1 ? '' : 's'}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

function FutureShowResultRow({
  show,
  query,
}: {
  show: FutureShow;
  query: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const accent = tokens.kindColor(show.kind as Kind);
  const venueLabel = [show.venueName, show.venueCity].filter(Boolean).join(' · ');

  return (
    <Link
      href={{ pathname: '/add/form', params: futureShowToFormParams(show) }}
      asChild
    >
      <Pressable
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: colors.surface, borderLeftColor: accent },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Add ${show.title} to your log`}
      >
        <View style={styles.rowBadgeRow}>
          <KindBadge kind={show.kind as Kind} size="sm" />
          <Text style={[styles.rowMeta, { color: colors.muted }]}>{show.date}</Text>
        </View>
        <HighlightedText
          text={show.title}
          query={query}
          style={[styles.rowTitle, { color: colors.ink }]}
        />
        <Text style={[styles.rowSubtitle, { color: colors.muted }]} numberOfLines={1}>
          {venueLabel}
        </Text>
      </Pressable>
    </Link>
  );
}

/**
 * A not-yet-followed artist (Ticketmaster attraction). Decorated with a
 * dashed outline + an accent "Follow" pill so it reads as an add action
 * rather than a log entry. Tapping the row (or the pill) follows inline.
 */
function DiscoverArtistResultRow({
  artist,
  query,
  followed,
  pending,
  onFollow,
}: {
  artist: DiscoverArtist;
  query: string;
  followed: boolean;
  pending: boolean;
  onFollow: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const initial = artist.name.trim()[0]?.toUpperCase() ?? '?';

  return (
    <Pressable
      onPress={followed || pending ? undefined : onFollow}
      disabled={followed || pending}
      accessibilityRole="button"
      accessibilityLabel={followed ? `Following ${artist.name}` : `Follow ${artist.name}`}
      testID={`search-discover-artist-${artist.id}`}
      style={({ pressed }) => [
        styles.row,
        styles.rowFlex,
        styles.discoverRow,
        { borderColor: colors.rule },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.avatar,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
        ]}
      >
        {artist.imageUrl ? (
          <Image source={{ uri: artist.imageUrl }} style={styles.avatarImage} />
        ) : (
          <Text style={[styles.avatarInitial, { color: colors.muted }]}>{initial}</Text>
        )}
      </View>
      <View style={styles.rowContent}>
        <HighlightedText
          text={artist.name}
          query={query}
          style={[styles.rowTitle, { color: colors.ink }]}
        />
        <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
          {followed ? 'Following' : 'Not in your log'}
        </Text>
      </View>
      <FollowPill followed={followed} pending={pending} />
    </Pressable>
  );
}

/**
 * A not-yet-followed venue from the catalog. Decorated like the
 * discoverable artists; links into the venue detail screen (where the
 * follow control lives) rather than following inline.
 */
function DiscoverVenueResultRow({
  venue,
  query,
}: {
  venue: DiscoverVenue;
  query: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <Link href={`/venues/${venue.id}`} asChild>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          styles.rowFlex,
          styles.discoverRow,
          { borderColor: colors.rule },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`View ${venue.name}`}
        testID={`search-discover-venue-${venue.id}`}
      >
        <View
          style={[
            styles.venueIcon,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
          ]}
        >
          <MapPin size={18} color={colors.muted} strokeWidth={2} />
        </View>
        <View style={styles.rowContent}>
          <HighlightedText
            text={venue.name}
            query={query}
            style={[styles.rowTitle, { color: colors.ink }]}
          />
          <Text style={[styles.rowSubtitle, { color: colors.muted }]} numberOfLines={1}>
            {venue.city ?? 'Location unknown'} · Not in your log
          </Text>
        </View>
        <ChevronRight size={18} color={colors.faint} strokeWidth={2} />
      </Pressable>
    </Link>
  );
}

/** Accent follow affordance shared by the discoverable rows. */
function FollowPill({
  followed,
  pending,
}: {
  followed: boolean;
  pending: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  if (pending) {
    return (
      <View style={[styles.followPill, { borderColor: colors.rule }]}>
        <ActivityIndicator size="small" color={colors.muted} />
      </View>
    );
  }
  if (followed) {
    return (
      <View style={[styles.followPill, { borderColor: colors.rule }]}>
        <Check size={12} color={colors.muted} strokeWidth={2.5} />
        <Text style={[styles.followPillLabel, { color: colors.muted }]}>Following</Text>
      </View>
    );
  }
  return (
    <View style={[styles.followPill, { borderColor: colors.accent }]}>
      <Plus size={12} color={colors.accent} strokeWidth={2.5} />
      <Text style={[styles.followPillLabel, { color: colors.accent }]}>Follow</Text>
    </View>
  );
}

function HighlightedText({
  text,
  query,
  style,
}: {
  text: string;
  query: string;
  style: React.ComponentProps<typeof Text>['style'];
}): React.JSX.Element {
  const { tokens } = useTheme();
  const match = extractHighlight(text, query, 24);
  if (!match) {
    return (
      <Text style={style} numberOfLines={1} ellipsizeMode="tail">
        {text}
      </Text>
    );
  }
  return (
    <Text style={style} numberOfLines={1} ellipsizeMode="tail">
      {match.before}
      <Text style={{ color: tokens.colors.accent, fontWeight: '700' }}>{match.match}</Text>
      {match.after}
    </Text>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Geist Sans 400',
    fontSize: 15,
    paddingVertical: 0,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 64,
    flexGrow: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  group: {
    paddingTop: 8,
    paddingBottom: 16,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  groupTitle: {
    fontFamily: 'Geist Sans 500',
    fontSize: 11,
    letterSpacing: 11 * 0.08,
    textTransform: 'uppercase',
  },
  groupList: {
    paddingHorizontal: 16,
    gap: 6,
  },
  row: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADII.lg,
    borderLeftWidth: 0,
    gap: 4,
  },
  rowFlex: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  discoverRow: {
    // Dashed outline + no fill so a not-yet-followed result reads as an
    // "add" affordance, visually distinct from the solid log-result rows.
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  followPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 28,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  followPillLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  rowBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  pressed: {
    opacity: 0.85,
  },
  rowTitle: {
    fontFamily: 'Geist Sans 600',
    fontSize: 15,
    lineHeight: 19,
  },
  rowSubtitle: {
    fontFamily: 'Geist Sans 400',
    fontSize: 12.5,
    lineHeight: 17,
  },
  rowMeta: {
    fontFamily: 'Geist Sans 500',
    fontSize: 11.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 36,
    height: 36,
  },
  avatarInitial: {
    fontFamily: 'Geist Sans 600',
    fontSize: 15,
  },
  venueIcon: {
    width: 36,
    height: 36,
    borderRadius: RADII.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
