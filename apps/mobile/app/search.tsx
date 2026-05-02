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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Link } from 'expo-router';
import {
  ChevronLeft,
  Search as SearchIcon,
  X,
  Music,
  Users,
  MapPin,
} from 'lucide-react-native';
import { TopBar } from '../components/TopBar';
import { EmptyState } from '../components/EmptyState';
import { KindBadge } from '../components/KindBadge';
import { useTheme, type Kind } from '../lib/theme';
import { useAuth } from '../lib/auth';
import { trpc } from '../lib/trpc';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import {
  extractHighlight,
  groupResults,
  isEmptyQuery,
  type GroupedSearchResults,
  type RawGlobalResults,
  type SearchPerformer,
  type SearchShow,
  type SearchVenue,
} from '../lib/search';

const SEARCH_DEBOUNCE_MS = 250;

export default function SearchScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();

  const [query, setQuery] = React.useState('');
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const trimmed = debounced.trim();
  const empty = isEmptyQuery(trimmed);

  const searchQuery = trpc.search.global.useQuery(
    { query: trimmed },
    {
      enabled: Boolean(token) && !empty,
      staleTime: 30_000,
    },
  );

  const grouped: GroupedSearchResults = React.useMemo(
    () => groupResults((searchQuery.data as RawGlobalResults | undefined) ?? null),
    [searchQuery.data],
  );

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
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Search" eyebrow="SHOWS · ARTISTS · VENUES" leading={back} />

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
        {empty ? (
          <EmptyState
            icon={<SearchIcon size={40} color={colors.faint} strokeWidth={1.5} />}
            title="Search your log"
            subtitle="Find shows, artists, and venues across everything you've added."
          />
        ) : searchQuery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : grouped.total === 0 ? (
          <EmptyState
            icon={<SearchIcon size={40} color={colors.faint} strokeWidth={1.5} />}
            title="No matches"
            subtitle={`Nothing in your log matches "${trimmed}". Try a different spelling or fewer words.`}
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
          </>
        )}
      </ScrollView>
    </View>
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
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '400',
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
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
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
    borderRadius: 12,
    borderLeftWidth: 0,
    gap: 4,
  },
  rowFlex: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 19,
  },
  rowSubtitle: {
    fontFamily: 'Geist Sans',
    fontSize: 12.5,
    fontWeight: '400',
    lineHeight: 17,
  },
  rowMeta: {
    fontFamily: 'Geist Sans',
    fontSize: 11.5,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '600',
  },
  venueIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
