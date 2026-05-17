/**
 * Add show — structured form.
 *
 * Reached from the chat screen with a parsed payload pre-filled into
 * search params, or directly from the "form" affordance on the chat
 * screen with no params (blank form).
 *
 * Submits via `shows.create`. On success we invalidate `shows.list`
 * and pop back. The screen also routes to the same form (with mode
 * `edit`) — see `app/show/[id]/edit.tsx`.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, X, Check } from 'lucide-react-native';

import { TopBar } from '../../components/TopBar';
import { SegmentedControl } from '../../components/SegmentedControl';
import { VenueTypeahead, type VenueSuggestion } from '../../components/VenueTypeahead';
import { FormField, FormRow } from '../../components/FormField';
import { useTheme } from '../../lib/theme';
import { useFormState } from '../../lib/useFormState';
import { trpc } from '../../lib/trpc';
import { useFeedback } from '../../lib/feedback';
import { runOptimisticMutation } from '../../lib/mutations';
import { getCacheOutbox } from '../../lib/cache';

// Local kind union; the theme's Kind includes the non-watchable kinds
// (sports, film, unknown) which can't be manually added — see
// NON_WATCHABLE_KINDS in @showbook/shared. The segmented control limits
// choices to the watchable subset.
type Kind = 'concert' | 'theatre' | 'comedy' | 'festival';

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'concert', label: 'Concert' },
  { value: 'theatre', label: 'Theatre' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'festival', label: 'Festival' },
];

interface FormValues {
  kind: Kind;
  headliner: string;
  venueQuery: string;
  venue: VenueSuggestion | null;
  date: string;
  time: string;
  seat: string;
  pricePaid: string;
  ticketCount: string;
  productionName: string;
  tourName: string;
  notes: string;
  supportActs: string;
}

function paramString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function paramKind(value: string | string[] | undefined): Kind {
  const raw = paramString(value);
  if (raw === 'theatre' || raw === 'comedy' || raw === 'festival') return raw;
  return 'concert';
}

export default function AddFormScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const utils = trpc.useUtils();
  const { showToast } = useFeedback();

  const { values, set } = useFormState<FormValues>({
    kind: paramKind(params.kindHint),
    headliner: paramString(params.headliner),
    venueQuery: paramString(params.venueHint),
    venue: null,
    date: paramString(params.dateHint),
    time: '',
    seat: paramString(params.seatHint),
    pricePaid: '',
    ticketCount: '1',
    productionName: '',
    tourName: '',
    notes: '',
    supportActs: '',
  });

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

  const [submitting, setSubmitting] = React.useState(false);

  const submit = React.useCallback(async () => {
    if (!values.headliner.trim()) {
      showToast({ kind: 'error', text: 'Add a headliner' });
      return;
    }
    if (!values.venue && !values.venueQuery.trim()) {
      showToast({ kind: 'error', text: 'Pick or enter a venue' });
      return;
    }
    if (!isYmd(values.date)) {
      showToast({ kind: 'error', text: 'Date must be YYYY-MM-DD' });
      return;
    }

    const venuePayload = values.venue
      ? {
          name: values.venue.name,
          city: values.venue.city ?? 'Unknown',
          stateRegion: values.venue.stateRegion ?? undefined,
          country: values.venue.country ?? undefined,
        }
      : { name: values.venueQuery.trim(), city: 'Unknown' };

    const supports = values.supportActs
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name, i) => ({
        name,
        role: 'support' as const,
        sortOrder: i + 1,
      }));

    setSubmitting(true);
    try {
      // Route through the optimistic runner so a failed Create persists
      // in the SQLite outbox instead of vanishing with the form. The
      // shows.list cache slot is invalidated on success in `reconcile`,
      // matching the previous useMutation onSuccess behavior.
      const { result } = await runOptimisticMutation<
        Parameters<typeof utils.client.shows.create.mutate>[0],
        void,
        Awaited<ReturnType<typeof utils.client.shows.create.mutate>>
      >({
        mutation: 'shows.create',
        input: {
          kind: values.kind,
          headliner: { name: values.headliner.trim() },
          venue: venuePayload,
          date: values.date,
          seat: values.seat.trim() || undefined,
          pricePaid: values.pricePaid.trim() || undefined,
          ticketCount: Math.max(1, Number(values.ticketCount) || 1),
          tourName: values.tourName.trim() || undefined,
          productionName: values.productionName.trim() || undefined,
          notes: values.notes.trim() || undefined,
          performers: supports.length > 0 ? supports : undefined,
        },
        outbox: getCacheOutbox(),
        call: (input) => utils.client.shows.create.mutate(input),
        reconcile: () => {
          void utils.shows.list.invalidate();
        },
      });
      const newId = result?.id;
      showToast({ kind: 'success', text: 'Show added' });
      if (newId) {
        router.replace(`/show/${newId}`);
      } else {
        router.back();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save';
      showToast({ kind: 'error', text: message });
    } finally {
      setSubmitting(false);
    }
  }, [values, utils, router, showToast]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title="New show"
        leading={
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <ChevronLeft size={22} color={colors.ink} strokeWidth={2} />
          </Pressable>
        }
        rightAction={
          <Pressable
            onPress={() => void submit()}
            hitSlop={10}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Save"
            testID="save-show"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Check size={22} color={colors.accent} strokeWidth={2.4} />
            )}
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <FormField label="Kind">
            <SegmentedControl
              options={KIND_OPTIONS}
              value={values.kind}
              onChange={(k) => set('kind', k)}
            />
          </FormField>

          <FormField
            label={values.kind === 'theatre' ? 'Production' : 'Headliner'}
            value={values.headliner}
            onChangeText={(v) => set('headliner', v)}
            placeholder={
              values.kind === 'theatre' ? 'Production name' : 'Artist or comedian'
            }
            autoCapitalize="words"
            testID="headliner-input"
          />

          <FormField label="Venue">
            <VenueTypeahead
              value={values.venueQuery}
              onChange={(v) => {
                set('venueQuery', v);
                if (values.venue && v !== values.venue.name) {
                  set('venue', null);
                }
              }}
              onSelect={(venue) => {
                set('venue', venue);
                set('venueQuery', venue.name);
                setVenueResults([]);
              }}
              onSearch={runVenueSearch}
              suggestions={venueResults}
              loading={venueLoading}
              placeholder={
                values.kind === 'festival' ? 'Festival grounds' : 'Search venues'
              }
              testID="venue-typeahead"
            />
            {values.venue ? (
              <Pressable
                onPress={() => set('venue', null)}
                style={[styles.venuePill, { backgroundColor: colors.accent }]}
                accessibilityRole="button"
                accessibilityLabel="Clear venue"
              >
                <Text style={[styles.venuePillText, { color: colors.accentText }]}>
                  {values.venue.name}
                </Text>
                <X size={12} color={colors.accentText} strokeWidth={2.4} />
              </Pressable>
            ) : null}
          </FormField>

          <FormRow>
            <FormField
              label="Date"
              flex={1}
              value={values.date}
              onChangeText={(v) => set('date', v)}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
            <FormField
              label="Time"
              flex={1}
              value={values.time}
              onChangeText={(v) => set('time', v)}
              placeholder="HH:MM"
              autoCapitalize="none"
            />
          </FormRow>

          {values.kind !== 'theatre' && values.kind !== 'festival' ? (
            <FormField
              label="Tour name (optional)"
              value={values.tourName}
              onChangeText={(v) => set('tourName', v)}
              placeholder="World tour, residency, …"
            />
          ) : null}

          {values.kind === 'theatre' ? (
            <FormField
              label="Production name (optional override)"
              value={values.productionName}
              onChangeText={(v) => set('productionName', v)}
              placeholder="Defaults to the headliner field"
            />
          ) : null}

          <FormField
            label="Support / lineup"
            value={values.supportActs}
            onChangeText={(v) => set('supportActs', v)}
            placeholder="Comma-separated"
            multiline
            numberOfLines={2}
          />

          <FormRow>
            <FormField
              label="Seat"
              flex={2}
              value={values.seat}
              onChangeText={(v) => set('seat', v)}
              placeholder="Section, row, seat"
            />
            <FormField
              label="Tickets"
              flex={1}
              value={values.ticketCount}
              onChangeText={(v) => set('ticketCount', v.replace(/[^0-9]/g, ''))}
              placeholder="1"
              keyboardType="numeric"
            />
          </FormRow>

          <FormField
            label="Price paid"
            value={values.pricePaid}
            onChangeText={(v) => set('pricePaid', v.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />

          <FormField
            label="Notes"
            value={values.notes}
            onChangeText={(v) => set('notes', v)}
            placeholder="Anything you want to remember"
            multiline
            numberOfLines={4}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 64,
    gap: 16,
  },
  venuePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginTop: 4,
  },
  venuePillText: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '600',
  },
});
