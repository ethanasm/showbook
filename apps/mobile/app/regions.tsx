/**
 * Regions editor — the mobile counterpart to the web Preferences "Regions"
 * section. Renders the user's saved regions and lets them add / remove /
 * toggle exactly as web does:
 *
 *   - list every region with its city + radius, and an active / inactive
 *     state pill that toggles on tap
 *   - swipe-free remove via an explicit "Remove" button per row
 *   - inline "Add a region" form below the list — city search hits the
 *     same `enrichment.searchPlaces` / `enrichment.placeDetails`
 *     procedures the web picker uses
 *   - hard cap of MAX_REGIONS (5) enforced both on the client (button
 *     disable + helper copy) and on the server (`preferences.addRegion`).
 *
 * All three mutations route through `runOptimisticMutation` so they
 * persist into the `pending_writes` outbox and survive offline / kill.
 * The OfflineBridge dispatcher in `_layout.tsx` already handles every
 * `preferences.*` payload — no new outbox case needed.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, MapPin, Plus, X, Check } from 'lucide-react-native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { useFeedback } from '@/lib/feedback';
import { runOptimisticMutation } from '@/lib/mutations';
import { getCacheOutbox } from '@/lib/cache';
import {
  MAX_REGIONS,
  DEFAULT_RADIUS_MILES,
  RADIUS_OPTIONS,
  canAddRegion,
  parseRegionInput,
} from '@/lib/regions';

interface RegionRow {
  id: string;
  cityName: string;
  radiusMiles: number;
  latitude: number;
  longitude: number;
  active: boolean;
}

export default function RegionsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const utils = trpc.useUtils();
  const { showToast } = useFeedback();

  const prefsQuery = trpc.preferences.get.useQuery(undefined, {
    staleTime: 60_000,
  });
  const regions = (prefsQuery.data?.regions ?? []) as RegionRow[];
  const atCap = !canAddRegion(regions.length);

  // The list and the form share an "is anything in flight?" gate so a
  // burst of taps doesn't enqueue stacked mutations against the same
  // region row.
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);

  const refresh = React.useCallback(() => {
    void utils.preferences.get.invalidate();
  }, [utils]);

  const onToggle = React.useCallback(
    async (region: RegionRow) => {
      if (pendingId) return;
      setPendingId(region.id);
      try {
        await runOptimisticMutation({
          mutation: 'preferences.toggleRegion',
          input: { regionId: region.id },
          outbox: getCacheOutbox(),
          call: (input) => utils.client.preferences.toggleRegion.mutate(input),
          reconcile: () => refresh(),
        });
      } catch (err) {
        showToast({
          kind: 'error',
          text: err instanceof Error ? err.message : 'Could not toggle region',
        });
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, refresh, showToast, utils.client.preferences.toggleRegion],
  );

  const onRemove = React.useCallback(
    async (region: RegionRow) => {
      if (pendingId) return;
      setPendingId(region.id);
      try {
        await runOptimisticMutation({
          mutation: 'preferences.removeRegion',
          input: { regionId: region.id },
          outbox: getCacheOutbox(),
          call: (input) => utils.client.preferences.removeRegion.mutate(input),
          reconcile: () => refresh(),
        });
        showToast({ kind: 'success', text: `Removed ${region.cityName}` });
      } catch (err) {
        showToast({
          kind: 'error',
          text: err instanceof Error ? err.message : 'Could not remove region',
        });
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, refresh, showToast, utils.client.preferences.removeRegion],
  );

  const onAdd = React.useCallback(
    async (input: { cityName: string; latitude: number; longitude: number; radiusMiles: number }) => {
      try {
        await runOptimisticMutation({
          mutation: 'preferences.addRegion',
          input,
          outbox: getCacheOutbox(),
          call: (i) => utils.client.preferences.addRegion.mutate(i),
          reconcile: () => refresh(),
        });
        showToast({ kind: 'success', text: `Added ${input.cityName}` });
        setAdding(false);
      } catch (err) {
        showToast({
          kind: 'error',
          text: err instanceof Error ? err.message : 'Could not add region',
        });
        throw err;
      }
    },
    [refresh, showToast, utils.client.preferences.addRegion],
  );

  const back = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/me'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  return (
    <ScreenWrapper
      title="Regions"
      eyebrow="PREFERENCES"
      leading={back}
      large
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.intro, { color: colors.muted }]}>
          Where to look for nearby shows. Active regions power your Discover
          feed and the daily email digest.
        </Text>

        <View style={styles.counterRow}>
          <Text
            style={[
              styles.counter,
              { color: atCap ? colors.danger : colors.muted },
            ]}
          >
            {regions.length} / {MAX_REGIONS} regions
          </Text>
        </View>

        {prefsQuery.isLoading ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : regions.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
            <Text style={[styles.emptyText, { color: colors.faint }]}>
              No regions yet — add one below to start seeing nearby shows.
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.card,
              styles.cardNoPad,
              { backgroundColor: colors.surface, borderColor: colors.rule },
            ]}
          >
            {regions.map((region, i) => (
              <RegionRowView
                key={region.id}
                region={region}
                isLast={i === regions.length - 1}
                disabled={pendingId !== null}
                pending={pendingId === region.id}
                onToggle={() => void onToggle(region)}
                onRemove={() => void onRemove(region)}
              />
            ))}
          </View>
        )}

        {atCap ? (
          <Text style={[styles.helper, { color: colors.faint }]}>
            Maximum {MAX_REGIONS} regions — remove one to add another.
          </Text>
        ) : adding ? (
          <AddRegionForm
            onCancel={() => setAdding(false)}
            onSubmit={onAdd}
          />
        ) : (
          <Pressable
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="Add a region"
            testID="regions-add-button"
            style={({ pressed }) => [
              styles.addButton,
              { borderColor: colors.rule, backgroundColor: colors.surface },
              pressed && styles.pressed,
            ]}
          >
            <Plus size={14} color={colors.accent} strokeWidth={2} />
            <Text style={[styles.addButtonLabel, { color: colors.accent }]}>
              Add a region
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

function RegionRowView({
  region,
  isLast,
  disabled,
  pending,
  onToggle,
  onRemove,
}: {
  region: RegionRow;
  isLast: boolean;
  disabled: boolean;
  pending: boolean;
  onToggle: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      style={[
        styles.row,
        !isLast && {
          borderBottomColor: colors.rule,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Pressable
        onPress={onToggle}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${region.active ? 'Deactivate' : 'Activate'} ${region.cityName}`}
        testID={`region-toggle-${region.id}`}
        style={({ pressed }) => [
          styles.rowMain,
          { opacity: disabled ? 0.5 : 1 },
          pressed && styles.pressed,
        ]}
      >
        <MapPin
          size={16}
          color={region.active ? colors.accent : colors.faint}
          strokeWidth={2}
        />
        <View style={styles.rowText}>
          <Text style={[styles.rowLabel, { color: colors.ink }]} numberOfLines={1}>
            {region.cityName}
          </Text>
          <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
            {region.radiusMiles}mi radius {region.active ? '· active' : '· paused'}
          </Text>
        </View>
        {region.active ? <Check size={16} color={colors.accent} strokeWidth={2} /> : null}
      </Pressable>
      <Pressable
        onPress={onRemove}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${region.cityName}`}
        testID={`region-remove-${region.id}`}
        hitSlop={10}
        style={({ pressed }) => [
          styles.removeButton,
          { opacity: disabled ? 0.4 : 1 },
          pressed && styles.pressed,
        ]}
      >
        {pending ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <X size={16} color={colors.faint} strokeWidth={2} />
        )}
      </Pressable>
    </View>
  );
}

function AddRegionForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: {
    cityName: string;
    latitude: number;
    longitude: number;
    radiusMiles: number;
  }) => Promise<void>;
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

  const onQueryChange = React.useCallback((value: string) => {
    setQuery(value);
    setError(null);
    // Reset the resolved selection if the user keeps typing — they're
    // looking for a different city than what they just picked.
    if (resolved !== null) setResolved(null);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (value.length >= 2) {
      debounceTimer.current = setTimeout(() => setDebouncedQuery(value), 300);
    } else {
      setDebouncedQuery('');
    }
  }, [resolved]);

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
      // Toast was already shown by the parent.
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
          accessibilityLabel="Add region"
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
              Add region
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
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 48,
    gap: 12,
  },
  intro: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    paddingHorizontal: 4,
    paddingTop: 8,
    lineHeight: 17,
  },
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 4,
  },
  counter: {
    fontFamily: 'Geist Sans 500',
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  card: {
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: 16,
  },
  cardNoPad: {
    padding: 0,
    overflow: 'hidden',
  },
  emptyText: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontFamily: 'Geist Sans 500',
    fontSize: 14,
  },
  rowSub: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    marginTop: 2,
  },
  removeButton: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: RADII.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addButtonLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  helper: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingTop: 4,
  },
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
