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
  TextInput,
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
import { useTheme } from '../../lib/theme';
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

  const [values, setValues] = React.useState<FormValues>({
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

  const set = React.useCallback(
    <K extends keyof FormValues>(key: K, next: FormValues[K]) =>
      setValues((prev) => ({ ...prev, [key]: next })),
    [],
  );

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
          <Field label="Kind">
            <SegmentedControl
              options={KIND_OPTIONS}
              value={values.kind}
              onChange={(k) => set('kind', k)}
            />
          </Field>

          <Field label={values.kind === 'theatre' ? 'Production' : 'Headliner'}>
            <Input
              value={values.headliner}
              onChangeText={(v) => set('headliner', v)}
              placeholder={
                values.kind === 'theatre'
                  ? 'Production name'
                  : 'Artist or comedian'
              }
              autoCapitalize="words"
              testID="headliner-input"
            />
          </Field>

          <Field label="Venue">
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
          </Field>

          <Row>
            <Field label="Date" flex={1}>
              <Input
                value={values.date}
                onChangeText={(v) => set('date', v)}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
              />
            </Field>
            <Field label="Time" flex={1}>
              <Input
                value={values.time}
                onChangeText={(v) => set('time', v)}
                placeholder="HH:MM"
                autoCapitalize="none"
              />
            </Field>
          </Row>

          {values.kind !== 'theatre' && values.kind !== 'festival' ? (
            <Field label="Tour name (optional)">
              <Input
                value={values.tourName}
                onChangeText={(v) => set('tourName', v)}
                placeholder="World tour, residency, …"
              />
            </Field>
          ) : null}

          {values.kind === 'theatre' ? (
            <Field label="Production name (optional override)">
              <Input
                value={values.productionName}
                onChangeText={(v) => set('productionName', v)}
                placeholder="Defaults to the headliner field"
              />
            </Field>
          ) : null}

          <Field label="Support / lineup">
            <Input
              value={values.supportActs}
              onChangeText={(v) => set('supportActs', v)}
              placeholder="Comma-separated"
              multiline
              numberOfLines={2}
            />
          </Field>

          <Row>
            <Field label="Seat" flex={2}>
              <Input
                value={values.seat}
                onChangeText={(v) => set('seat', v)}
                placeholder="Section, row, seat"
              />
            </Field>
            <Field label="Tickets" flex={1}>
              <Input
                value={values.ticketCount}
                onChangeText={(v) => set('ticketCount', v.replace(/[^0-9]/g, ''))}
                placeholder="1"
                keyboardType="numeric"
              />
            </Field>
          </Row>

          <Field label="Price paid">
            <Input
              value={values.pricePaid}
              onChangeText={(v) => set('pricePaid', v.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
          </Field>

          <Field label="Notes">
            <Input
              value={values.notes}
              onChangeText={(v) => set('notes', v)}
              placeholder="Anything you want to remember"
              multiline
              numberOfLines={4}
            />
          </Field>
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

function Field({
  label,
  children,
  flex,
}: {
  label: string;
  children: React.ReactNode;
  flex?: number;
}): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View style={[styles.field, flex !== undefined && { flex }]}>
      <Text style={[styles.fieldLabel, { color: tokens.colors.faint }]}>
        {label.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.row}>{children}</View>;
}

function Input(
  props: React.ComponentProps<typeof TextInput>,
): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <TextInput
      {...props}
      placeholderTextColor={colors.faint}
      style={[
        styles.input,
        {
          color: colors.ink,
          borderColor: colors.rule,
          backgroundColor: colors.surface,
        },
        props.multiline && { minHeight: 72, textAlignVertical: 'top' },
        props.style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 64,
    gap: 16,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  input: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '400',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
