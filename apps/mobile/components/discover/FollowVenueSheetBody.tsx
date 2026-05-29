/**
 * Venue-follow typeahead body rendered inside the Discover add sheet.
 *
 * Mirrors `apps/web/components/VenueSearchModal.tsx`:
 *   - Debounced input (250 ms, ≥ 2 chars to fire).
 *   - Parallel local + Google Places suggestions via
 *     `useVenueSearch`. Local hits surface first; Places hits sit
 *     under a "From Google Places" sub-header.
 *   - Tap a row → follow. Places hits go through
 *     `venues.createFromPlace` → `venues.follow`; local hits go
 *     straight to `venues.follow` (outbox-queued).
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
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { useNetwork } from '@/lib/network';
import { useFeedback } from '@/lib/feedback';
import { runOptimisticMutation } from '@/lib/mutations';
import { getCacheOutbox, invalidateDiscoverFeeds } from '@/lib/cache';
import { useVenueSearch } from '@/lib/useVenueSearch';
import { useDebouncedValue } from '@showbook/shared/hooks';
import { entityLimitReachedHint } from '@showbook/shared';
import type { VenueSuggestion } from '../VenueTypeahead';

export function FollowVenueSheetBody({
  onFollowed,
  onClose,
  atCap = false,
}: {
  /** Called after a successful follow lands so the parent can dismiss
   *  the sheet. The sheet stays mounted on cancel to preserve in-flight
   *  state. */
  onFollowed: () => void;
  onClose: () => void;
  /** When true the user is at the followed-venue cap: the search UI is
   *  replaced by a persistent cap message, mirroring the region sheet. */
  atCap?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const network = useNetwork();
  const { showToast } = useFeedback();

  const venueSearch = useVenueSearch(utils.client);
  const [query, setQuery] = React.useState('');
  const debounced = useDebouncedValue(query, 250);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    const trimmed = debounced.trim();
    if (trimmed.length < 2) return;
    venueSearch.runSearch(trimmed);
  }, [debounced, venueSearch]);

  const localSuggestions = venueSearch.suggestions.filter((s) => !s.placeId);
  const placesSuggestions = venueSearch.suggestions.filter((s) => Boolean(s.placeId));

  const followVenue = React.useCallback(
    async (venueId: string, displayName: string) => {
      type FollowedCache = { id: string; name?: string }[] | undefined;
      const followedKey = ['mobile', 'venues', 'followed'];
      try {
        await runOptimisticMutation({
          mutation: 'venues.follow',
          input: { venueId },
          outbox: getCacheOutbox(),
          call: (input) => utils.client.venues.follow.mutate(input),
          optimistic: {
            snapshot: () => ({
              followed: queryClient.getQueryData<FollowedCache>(followedKey),
            }),
            apply: () => {
              queryClient.setQueryData<FollowedCache>(followedKey, (prev) => {
                const list = prev ?? [];
                if (list.some((v) => v.id === venueId)) return list;
                return [...list, { id: venueId, name: displayName }];
              });
            },
            rollback: (snap) => {
              queryClient.setQueryData(followedKey, snap.followed);
            },
          },
          reconcile: () => {
            void utils.venues.list.invalidate();
            // The Discover tab reads feeds / followed-lists / ingestStatus
            // under `['mobile', …]` keys, not these tRPC-native ones —
            // fan out across them so the just-followed venue appears and
            // the scoped ingest poll arms without a pull-to-refresh.
            invalidateDiscoverFeeds(queryClient);
          },
        });
        showToast({ kind: 'success', text: `Following ${displayName}` });
        onFollowed();
      } catch (err) {
        showToast({
          kind: 'info',
          text: "We'll follow when you're back online.",
        });
        throw err;
      }
    },
    [queryClient, utils, showToast, onFollowed],
  );

  const onPick = React.useCallback(
    async (suggestion: VenueSuggestion) => {
      if (pending) return;
      setPending(true);
      try {
        let venueId = suggestion.id;
        let displayName = suggestion.name;
        if (suggestion.placeId) {
          // Materializing a Google Places hit needs the network — both
          // the createFromPlace mutation (geocode + insert) and the
          // follow that chases it. We surface the error and bail rather
          // than queuing a half-done state.
          const created = await venueSearch.resolvePlace(suggestion.placeId);
          venueId = created.id;
          displayName = created.name;
        }
        await followVenue(venueId, displayName);
      } catch (err) {
        if (suggestion.placeId) {
          showToast({
            kind: 'error',
            text: err instanceof Error ? err.message : 'Could not add venue',
          });
        }
      } finally {
        setPending(false);
      }
    },
    [pending, venueSearch, followVenue, showToast],
  );

  const tooShort = debounced.trim().length < 2;
  const noResults =
    !tooShort &&
    !venueSearch.loading &&
    localSuggestions.length === 0 &&
    placesSuggestions.length === 0;

  return (
    <View style={styles.body}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.ink }]}>Follow a venue</Text>
      </View>

      {atCap ? (
        <Text
          style={[styles.capMessage, { color: colors.danger }]}
          testID="discover-venue-cap-message"
        >
          {entityLimitReachedHint('venues')}
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
          placeholder="Search venues…"
          placeholderTextColor={colors.faint}
          autoCorrect={false}
          autoCapitalize="words"
          autoFocus
          editable={!pending}
          testID="discover-add-venue-input"
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
          {venueSearch.loading && venueSearch.suggestions.length === 0 ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.muted} />
              <Text style={[styles.hint, { color: colors.muted }]}>Searching…</Text>
            </View>
          ) : null}

          {localSuggestions.map((s) => (
            <ResultRow
              key={s.id}
              suggestion={s}
              disabled={pending}
              onPress={() => void onPick(s)}
            />
          ))}

          {placesSuggestions.length > 0 && localSuggestions.length > 0 ? (
            <Text style={[styles.sectionHeader, { color: colors.muted }]}>
              From Google Places
            </Text>
          ) : null}

          {placesSuggestions.map((s) => (
            <ResultRow
              key={s.id}
              suggestion={s}
              disabled={pending}
              onPress={() => void onPick(s)}
            />
          ))}

          {noResults ? (
            <Text style={[styles.hint, { color: colors.faint }]}>
              No venues found.
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
        testID="discover-add-venue-cancel"
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

function ResultRow({
  suggestion,
  disabled,
  onPress,
}: {
  suggestion: VenueSuggestion;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const meta =
    suggestion.formattedAddress ??
    [suggestion.city, suggestion.stateRegion].filter(Boolean).join(', ');
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Follow ${suggestion.name}`}
      testID={`discover-add-venue-result-${suggestion.id}`}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.rule, backgroundColor: colors.surface },
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <View style={styles.rowBody}>
        <Text style={[styles.rowName, { color: colors.ink }]} numberOfLines={1}>
          {suggestion.name}
        </Text>
        {meta ? (
          <Text style={[styles.rowMeta, { color: colors.muted }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <View style={[styles.rowAction, { borderColor: colors.accent }]}>
        <Plus size={12} color={colors.accent} strokeWidth={2.5} />
        <Text style={[styles.rowActionLabel, { color: colors.accent }]}>
          Follow
        </Text>
      </View>
    </Pressable>
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
  sectionHeader: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10.5,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    paddingTop: 8,
    paddingBottom: 2,
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
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontFamily: 'Geist Sans 600',
    fontSize: 14,
  },
  rowMeta: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    marginTop: 2,
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
