/**
 * Artist-follow typeahead body rendered inside the Discover add sheet.
 *
 * Mirrors `apps/web/components/discover/FollowArtistSearch.tsx`:
 *   - Debounced input (250 ms, ≥ 2 chars to fire).
 *   - Ticketmaster attractions via `discover.searchArtists`.
 *   - Tap a row → `performers.followAttraction` (resolves the TM
 *     attraction into a local performer + inserts the follow row +
 *     kicks the on-follow ingest job). Online-only; both
 *     `searchArtists` and `followAttraction` reach external APIs.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Plus, Search } from 'lucide-react-native';
import { Image } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { invalidateDiscoverFeeds } from '@/lib/cache';
import { useNetwork } from '@/lib/network';
import { useFeedback } from '@/lib/feedback';
import { useDebouncedValue } from '@showbook/shared/hooks';
import { entityLimitReachedHint } from '@showbook/shared';

export function FollowArtistSheetBody({
  onFollowed,
  onClose,
  atCap = false,
}: {
  onFollowed: () => void;
  onClose: () => void;
  /** When true the user is at the followed-artist cap: the search UI is
   *  replaced by a persistent cap message, mirroring the region sheet. */
  atCap?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const network = useNetwork();
  const { showToast } = useFeedback();

  const [query, setQuery] = React.useState('');
  const debounced = useDebouncedValue(query.trim(), 250);
  const enabled = network.online && debounced.length >= 2;

  const results = trpc.discover.searchArtists.useQuery(
    { keyword: debounced },
    { enabled, staleTime: 60_000 },
  );

  const followAttraction = trpc.performers.followAttraction.useMutation({
    onSuccess: (_, vars) => {
      void utils.performers.list.invalidate();
      // Discover reads under `['mobile', …]` keys — fan out so the new
      // artist chip appears and its scoped ingest poll arms immediately.
      invalidateDiscoverFeeds(queryClient);
      showToast({ kind: 'success', text: `Following ${vars.name}` });
      onFollowed();
    },
    onError: (err) => {
      showToast({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not follow artist',
      });
    },
  });

  const onPick = (item: NonNullable<typeof results.data>[number]) => {
    if (followAttraction.isPending) return;
    followAttraction.mutate({
      tmAttractionId: item.id,
      name: item.name,
      imageUrl: item.imageUrl ?? undefined,
      musicbrainzId: item.mbid ?? undefined,
    });
  };

  const tooShort = debounced.length < 2;

  return (
    <View style={styles.body}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.ink }]}>Follow an artist</Text>
      </View>

      {atCap ? (
        <Text
          style={[styles.capMessage, { color: colors.danger }]}
          testID="discover-artist-cap-message"
        >
          {entityLimitReachedHint('artists')}
        </Text>
      ) : (
      <>
      <View
        style={[
          styles.searchRow,
          { borderColor: colors.rule, backgroundColor: colors.bg },
        ]}
      >
        <Search size={14} color={colors.muted} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search artists…"
          placeholderTextColor={colors.faint}
          autoCorrect={false}
          autoCapitalize="words"
          autoFocus
          editable={!followAttraction.isPending}
          testID="discover-add-artist-input"
          style={[styles.searchInput, { color: colors.ink }]}
          returnKeyType="search"
        />
      </View>

      {!network.online ? (
        <Text style={[styles.hint, { color: colors.muted }]}>
          Search unavailable offline.
        </Text>
      ) : tooShort ? (
        <Text style={[styles.hint, { color: colors.muted }]}>
          Type at least 2 characters to search.
        </Text>
      ) : (
        <ScrollView
          style={styles.results}
          contentContainerStyle={styles.resultsContent}
          keyboardShouldPersistTaps="handled"
        >
          {results.isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.muted} />
              <Text style={[styles.hint, { color: colors.muted }]}>Searching…</Text>
            </View>
          ) : null}

          {(results.data ?? []).map((item) => (
            <Pressable
              key={item.id}
              onPress={() => onPick(item)}
              disabled={followAttraction.isPending}
              accessibilityRole="button"
              accessibilityLabel={`Follow ${item.name}`}
              testID={`discover-add-artist-result-${item.id}`}
              style={({ pressed }) => [
                styles.row,
                { borderColor: colors.rule, backgroundColor: colors.surface },
                pressed && { opacity: 0.7 },
                followAttraction.isPending && { opacity: 0.5 },
              ]}
            >
              {item.imageUrl ? (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={[styles.avatar, { backgroundColor: colors.surfaceRaised }]}
                  contentFit="cover"
                />
              ) : (
                <View
                  style={[
                    styles.avatar,
                    styles.avatarPlaceholder,
                    { backgroundColor: colors.surfaceRaised },
                  ]}
                />
              )}
              <View style={styles.rowBody}>
                <Text style={[styles.rowName, { color: colors.ink }]} numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
              <View style={[styles.rowAction, { borderColor: colors.accent }]}>
                <Plus size={12} color={colors.accent} strokeWidth={2.5} />
                <Text style={[styles.rowActionLabel, { color: colors.accent }]}>
                  Follow
                </Text>
              </View>
            </Pressable>
          ))}

          {!results.isLoading &&
          enabled &&
          (results.data?.length ?? 0) === 0 ? (
            <Text style={[styles.hint, { color: colors.faint }]}>
              No artists found.
            </Text>
          ) : null}
        </ScrollView>
      )}

      </>
      )}

      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        testID="discover-add-artist-cancel"
        style={({ pressed }) => [
          styles.cancelButton,
          { borderColor: colors.rule },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={[styles.cancelLabel, { color: colors.muted }]}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 12,
  },
  header: {
    paddingTop: 4,
    paddingBottom: 4,
  },
  title: {
    fontFamily: 'Geist Sans 700',
    fontSize: 18,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADII.lg,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 14,
    padding: 0,
  },
  results: {
    flex: 1,
  },
  resultsContent: {
    gap: 8,
    paddingBottom: 8,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADII.lg,
    borderWidth: 1,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarPlaceholder: {
    // Solid placeholder when TM didn't return an image; the surface
    // colour is set inline so it tracks the theme.
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontFamily: 'Geist Sans 600',
    fontSize: 14,
  },
  rowAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  rowActionLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  hint: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  capMessage: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  cancelButton: {
    paddingVertical: 12,
    borderRadius: RADII.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
