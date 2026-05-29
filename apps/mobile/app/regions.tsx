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
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, MapPin, Plus, X, Check } from 'lucide-react-native';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { AddRegionSheetBody } from '../components/discover/AddRegionSheetBody';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { useFeedback } from '@/lib/feedback';
import { runOptimisticMutation } from '@/lib/mutations';
import { getCacheOutbox } from '@/lib/cache';
import { MAX_REGIONS, canAddRegion } from '@/lib/regions';
import { entityLimitReachedHint } from '@showbook/shared';

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
            {entityLimitReachedHint('regions')}
          </Text>
        ) : adding ? (
          <AddRegionSheetBody
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
  pressed: {
    opacity: 0.85,
  },
});
