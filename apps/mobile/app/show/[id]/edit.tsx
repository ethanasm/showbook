/**
 * Edit show — same form shape as Add, prefilled from `shows.detail`,
 * persisted via the optimistic mutation runner.
 *
 * The "dirty" indicator in the top bar lights up the moment any field
 * diverges from the server snapshot. Save calls `runOptimisticMutation`
 * which writes the patched detail into the React Query cache before
 * the network round-trip and rolls back on failure. The cache is
 * reconciled with the server payload on success.
 */

import React from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { ChevronLeft, Check, Circle } from 'lucide-react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';
import { useQueryClient } from '@tanstack/react-query';

import { TopBar } from '../../../components/TopBar';
import { ShowFormFields } from '../../../components/ShowFormFields';
import type { VenueSuggestion } from '../../../components/VenueTypeahead';
import { useTheme } from '../../../lib/theme';
import { trpc } from '../../../lib/trpc';
import { useFeedback } from '../../../lib/feedback';
import { toUserMessage } from '../../../lib/errors';
import { runOptimisticMutation } from '../../../lib/mutations';
import { getCacheOutbox } from '../../../lib/cache';
import {
  buildShowFormFromDetail,
  serializeShowFormForKind,
  type ShowDetailLite,
  type ShowFormValues,
} from '../../../lib/showForm';
import { newPerformerRowId } from '../../../components/LineupEditor';

const SCREEN_OPTIONS = { presentation: 'modal', gestureEnabled: true } as const;

export default function EditShowScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const showId = typeof params.id === 'string' ? params.id : '';
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();

  const detailQuery = trpc.shows.detail.useQuery(
    { showId },
    { enabled: showId.length > 0 },
  );
  const detail = detailQuery.data as ShowDetailLite | undefined;

  const [initial, setInitial] = React.useState<ShowFormValues | null>(null);
  const [values, setValues] = React.useState<ShowFormValues | null>(null);

  React.useEffect(() => {
    if (detail && initial === null) {
      const next = buildShowFormFromDetail(detail, newPerformerRowId);
      setInitial(next);
      setValues(next);
    }
  }, [detail, initial]);

  const set = React.useCallback(
    <K extends keyof ShowFormValues>(key: K, next: ShowFormValues[K]) =>
      setValues((prev) => (prev ? { ...prev, [key]: next } : prev)),
    [],
  );

  const dirty = React.useMemo(() => {
    if (!initial || !values) return false;
    const keys = Object.keys(initial) as (keyof ShowFormValues)[];
    return keys.some((k) => {
      if (k === 'venue') {
        return (initial.venue?.id ?? null) !== (values.venue?.id ?? null);
      }
      if (k === 'performers') {
        // Shallow structural compare keyed by name/role/character/tier —
        // the row `id` is client-generated so two equivalent rows from
        // the same load won't show false dirty after they survive a
        // round-trip.
        if (initial.performers.length !== values.performers.length) return true;
        return initial.performers.some((row, i) => {
          const next = values.performers[i];
          return (
            row.name !== next.name ||
            (row.characterName ?? '') !== (next.characterName ?? '') ||
            (row.tier ?? 'support') !== (next.tier ?? 'support') ||
            (row.tmAttractionId ?? '') !== (next.tmAttractionId ?? '')
          );
        });
      }
      return initial[k] !== values[k];
    });
  }, [initial, values]);

  const [venueResults, setVenueResults] = React.useState<VenueSuggestion[]>([]);
  const [venueLoading, setVenueLoading] = React.useState(false);

  const runVenueSearch = React.useCallback(
    (q: string) => {
      setVenueLoading(true);
      utils.client.venues.search
        .query({ query: q })
        .then((rows) => {
          setVenueResults(
            rows.map((r) => ({
              id: r.id,
              name: r.name,
              city: r.city,
              stateRegion: r.stateRegion,
              country: r.country,
            })),
          );
        })
        .catch(() => setVenueResults([]))
        .finally(() => setVenueLoading(false));
    },
    [utils],
  );

  const [saving, setSaving] = React.useState(false);

  const submit = React.useCallback(async () => {
    if (!values || !detail) return;
    if (!values.title.trim()) {
      showToast({ kind: 'error', text: 'Title can’t be empty' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
      showToast({ kind: 'error', text: 'Date must be YYYY-MM-DD' });
      return;
    }
    if (
      values.kind === 'festival' &&
      values.endDate.trim() &&
      !/^\d{4}-\d{2}-\d{2}$/.test(values.endDate)
    ) {
      showToast({ kind: 'error', text: 'End date must be YYYY-MM-DD' });
      return;
    }

    const serialized = serializeShowFormForKind(values);
    const input = { showId, ...serialized };

    setSaving(true);
    // Mirror what tRPC's useQuery uses internally so optimistic
    // setQueryData hits the same cache slot as the screen's read.
    const detailKey = [['shows', 'detail'], { input: { showId }, type: 'query' }];
    try {
      await runOptimisticMutation({
        mutation: 'shows.update',
        input,
        outbox: getCacheOutbox(),
        call: (i) => utils.client.shows.update.mutate(i),
        optimistic: {
          snapshot: () => queryClient.getQueryData(detailKey),
          apply: () => {
            queryClient.setQueryData(detailKey, (prev: unknown) => {
              if (!prev || typeof prev !== 'object') return prev;
              return {
                ...prev,
                kind: input.kind,
                date: input.date,
                endDate: input.endDate ?? null,
                seat: input.seat ?? null,
                pricePaid: input.pricePaid ?? null,
                ticketCount: input.ticketCount,
                tourName: input.tourName ?? null,
                productionName:
                  input.productionName ??
                  (prev as { productionName?: string | null }).productionName ??
                  null,
                notes: input.notes ?? null,
              };
            });
          },
          rollback: (snap) => {
            queryClient.setQueryData(detailKey, snap);
          },
        },
        reconcile: () => {
          void utils.shows.detail.invalidate({ showId });
          void utils.shows.list.invalidate();
        },
      });
      showToast({ kind: 'success', text: 'Saved' });
      router.back();
    } catch (err) {
      showToast({ kind: 'error', text: toUserMessage(err, 'Could not save changes') });
    } finally {
      setSaving(false);
    }
  }, [values, detail, queryClient, utils, showId, router, showToast]);

  const stackOptions = <Stack.Screen options={SCREEN_OPTIONS} />;

  if (!detail || !values) {
    return (
      <>
        {stackOptions}
        <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
          <TopBar
            title="Edit show"
            leading={
              <Pressable onPress={() => router.back()} hitSlop={10}>
                <ChevronLeft size={22} color={colors.ink} strokeWidth={2} />
              </Pressable>
            }
          />
          <View style={styles.center}>
            <ActivityIndicator color={colors.muted} />
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      {stackOptions}
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <TopBar
          title="Edit show"
          eyebrow={dirty ? 'UNSAVED CHANGES' : undefined}
          leading={
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
              <ChevronLeft size={22} color={colors.ink} strokeWidth={2} />
            </Pressable>
          }
          rightAction={
            <Pressable
              onPress={() => void submit()}
              hitSlop={10}
              disabled={saving || !dirty}
              accessibilityRole="button"
              accessibilityLabel="Save"
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : dirty ? (
                <Check size={22} color={colors.accent} strokeWidth={2.4} />
              ) : (
                <Circle size={18} color={colors.faint} strokeWidth={2} />
              )}
            </Pressable>
          }
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <NestableScrollContainer
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <ShowFormFields
              values={values}
              set={set}
              venueSuggestions={venueResults}
              venueLoading={venueLoading}
              onVenueSearch={runVenueSearch}
            />
          </NestableScrollContainer>
        </KeyboardAvoidingView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 64,
    gap: 16,
  },
});
