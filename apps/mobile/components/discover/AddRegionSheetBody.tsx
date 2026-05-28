/**
 * Inline region-add form used by the regions editor (`app/regions.tsx`)
 * AND by the Discover tab's add sheet (`AddToDiscoverSheet.tsx`). Same
 * city typeahead → `enrichment.placeDetails` resolve → radius picker →
 * `preferences.addRegion` flow as the original inline form on the
 * regions screen; lifted into a shared component so both surfaces post
 * to the same backing logic.
 *
 * The component is headless about the mutation itself — the caller
 * supplies `onSubmit` so the regions screen can wrap it in
 * `runOptimisticMutation` (with the outbox + reconcile semantics it
 * already owns) and the Discover sheet can do the same without
 * threading the regions screen's helpers down through `Sheet`.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import {
  DEFAULT_RADIUS_MILES,
  RADIUS_OPTIONS,
  parseRegionInput,
} from '@/lib/regions';

export interface AddRegionInput {
  cityName: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
}

export function AddRegionSheetBody({
  onCancel,
  onSubmit,
  submitLabel = 'Add region',
}: {
  onCancel: () => void;
  onSubmit: (input: AddRegionInput) => Promise<void>;
  submitLabel?: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const utils = trpc.useUtils();

  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [resolved, setResolved] = React.useState<{
    cityName: string;
    latitude: number;
    longitude: number;
  } | null>(null);
  const [radius, setRadius] = React.useState<number>(DEFAULT_RADIUS_MILES);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const onQueryChange = React.useCallback(
    (value: string) => {
      setQuery(value);
      setError(null);
      if (resolved !== null) setResolved(null);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (value.length >= 2) {
        debounceTimer.current = setTimeout(() => setDebouncedQuery(value), 300);
      } else {
        setDebouncedQuery('');
      }
    },
    [resolved],
  );

  const citySearch = trpc.enrichment.searchPlaces.useQuery(
    { query: debouncedQuery, types: 'city' },
    { enabled: debouncedQuery.length >= 2 && !resolved, retry: false },
  );

  const onPick = React.useCallback(
    async (placeId: string) => {
      setError(null);
      try {
        const details = await utils.client.enrichment.placeDetails.query({
          placeId,
        });
        if (!details) throw new Error('No details for that place');
        const cityName = details.city || details.name;
        setResolved({
          cityName,
          latitude: details.latitude,
          longitude: details.longitude,
        });
        setQuery(cityName);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load city details');
      }
    },
    [utils.client.enrichment.placeDetails],
  );

  const onSubmitPressed = React.useCallback(async () => {
    if (!resolved) {
      setError('Pick a city from the suggestions first.');
      return;
    }
    const parsed = parseRegionInput({
      cityName: resolved.cityName,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      radiusMiles: radius,
    });
    if (!parsed.ok) {
      setError('Invalid input — pick a different city or radius.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(parsed.value);
    } catch {
      // Caller surfaces an error toast.
    } finally {
      setSubmitting(false);
    }
  }, [resolved, radius, onSubmit]);

  return (
    <View
      style={[
        styles.formCard,
        { backgroundColor: colors.surface, borderColor: colors.rule },
      ]}
    >
      <Text style={[styles.formLabel, { color: colors.muted }]}>CITY</Text>
      <TextInput
        value={query}
        onChangeText={onQueryChange}
        placeholder="e.g. Nashville"
        placeholderTextColor={colors.faint}
        autoCorrect={false}
        autoCapitalize="words"
        editable={!submitting}
        testID="regions-add-city-input"
        style={[
          styles.formInput,
          { color: colors.ink, borderColor: colors.rule, backgroundColor: colors.bg },
        ]}
      />

      {!resolved && debouncedQuery.length >= 2 ? (
        <View style={styles.suggestions}>
          {citySearch.isLoading ? (
            <Text style={[styles.formHint, { color: colors.muted }]}>Searching…</Text>
          ) : null}
          {citySearch.isError ? (
            <Text style={[styles.formHint, { color: colors.danger }]}>
              City search is unavailable right now.
            </Text>
          ) : null}
          {citySearch.data?.slice(0, 5).map((p) => (
            <Pressable
              key={p.placeId}
              onPress={() => void onPick(p.placeId)}
              disabled={submitting}
              accessibilityRole="button"
              testID={`regions-add-suggestion-${p.placeId}`}
              style={({ pressed }) => [
                styles.suggestion,
                { borderColor: colors.rule },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.suggestionName, { color: colors.ink }]} numberOfLines={1}>
                {p.displayName}
              </Text>
              <Text
                style={[styles.suggestionMeta, { color: colors.muted }]}
                numberOfLines={1}
              >
                {p.formattedAddress}
              </Text>
            </Pressable>
          ))}
          {citySearch.data && citySearch.data.length === 0 && !citySearch.isLoading ? (
            <Text style={[styles.formHint, { color: colors.faint }]}>No matches</Text>
          ) : null}
        </View>
      ) : null}

      <Text style={[styles.formLabel, { color: colors.muted, marginTop: 12 }]}>
        RADIUS
      </Text>
      <View style={styles.radiusRow}>
        {RADIUS_OPTIONS.map((mi) => {
          const selected = radius === mi;
          return (
            <Pressable
              key={mi}
              onPress={() => setRadius(mi)}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={`${mi} mile radius`}
              testID={`regions-add-radius-${mi}`}
              style={[
                styles.radiusChip,
                {
                  borderColor: selected ? colors.accent : colors.rule,
                  backgroundColor: selected ? colors.accentFaded : 'transparent',
                },
              ]}
            >
              <Text
                style={[
                  styles.radiusChipLabel,
                  { color: selected ? colors.accent : colors.muted },
                ]}
              >
                {mi}mi
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <Text style={[styles.formError, { color: colors.danger }]}>{error}</Text>
      ) : null}

      <View style={styles.formActions}>
        <Pressable
          onPress={() => void onSubmitPressed()}
          disabled={submitting || !resolved}
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
          testID="regions-add-submit"
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: colors.accent,
              opacity: submitting || !resolved ? 0.5 : 1,
            },
            pressed && styles.pressed,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={[styles.primaryButtonLabel, { color: colors.accentText }]}>
              {submitLabel}
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={onCancel}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: colors.rule },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.secondaryButtonLabel, { color: colors.muted }]}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  formCard: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  formLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10.5,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  formInput: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: RADII.lg,
  },
  suggestions: {
    gap: 4,
    marginTop: 4,
  },
  suggestion: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: RADII.md,
  },
  suggestionName: {
    fontFamily: 'Geist Sans 600',
    fontSize: 13,
  },
  suggestionMeta: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    marginTop: 1,
  },
  formHint: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 6,
  },
  radiusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  radiusChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADII.pill,
    borderWidth: 1,
  },
  radiusChipLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  formError: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    marginTop: 4,
  },
  formActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonLabel: {
    fontFamily: 'Geist Sans 700',
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: RADII.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  pressed: {
    opacity: 0.85,
  },
});
