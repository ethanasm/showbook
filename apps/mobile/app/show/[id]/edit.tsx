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
import { ChevronLeft, X, Check, Circle } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';

import { TopBar } from '../../../components/TopBar';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { VenueTypeahead, type VenueSuggestion } from '../../../components/VenueTypeahead';
import { useTheme } from '../../../lib/theme';
import { trpc } from '../../../lib/trpc';
import { useFeedback } from '../../../lib/feedback';
import { runOptimisticMutation } from '../../../lib/mutations';
import { getCacheOutbox } from '../../../lib/cache';

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
  seat: string;
  pricePaid: string;
  ticketCount: string;
  productionName: string;
  tourName: string;
  notes: string;
  supportActs: string;
}

interface ShowDetailLike {
  id: string;
  kind: Kind;
  date: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
  tourName: string | null;
  productionName: string | null;
  notes: string | null;
  venue: { id: string; name: string; city: string; stateRegion: string | null };
  showPerformers: {
    role: 'headliner' | 'support' | 'cast';
    sortOrder: number;
    performer: { id: string; name: string };
  }[];
}

function buildInitialValues(detail: ShowDetailLike): FormValues {
  const performers = [...detail.showPerformers].sort((a, b) => a.sortOrder - b.sortOrder);
  const headliner = performers.find((p) => p.role === 'headliner');
  const supports = performers.filter((p) => p.role === 'support').map((p) => p.performer.name);
  const headlinerName =
    detail.kind === 'theatre'
      ? detail.productionName ?? headliner?.performer.name ?? ''
      : headliner?.performer.name ?? '';
  return {
    kind: detail.kind,
    headliner: headlinerName,
    venueQuery: detail.venue.name,
    venue: {
      id: detail.venue.id,
      name: detail.venue.name,
      city: detail.venue.city,
      stateRegion: detail.venue.stateRegion,
    },
    date: detail.date ?? '',
    seat: detail.seat ?? '',
    pricePaid: detail.pricePaid ?? '',
    ticketCount: String(detail.ticketCount ?? 1),
    productionName: detail.kind === 'theatre' ? '' : detail.productionName ?? '',
    tourName: detail.tourName ?? '',
    notes: detail.notes ?? '',
    supportActs: supports.join(', '),
  };
}

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

  const detailQuery = trpc.shows.detail.useQuery({ showId }, { enabled: showId.length > 0 });
  const detail = detailQuery.data as ShowDetailLike | undefined;

  const [initial, setInitial] = React.useState<FormValues | null>(null);
  const [values, setValues] = React.useState<FormValues | null>(null);

  React.useEffect(() => {
    if (detail && initial === null) {
      const next = buildInitialValues(detail);
      setInitial(next);
      setValues(next);
    }
  }, [detail, initial]);

  const set = React.useCallback(
    <K extends keyof FormValues>(key: K, next: FormValues[K]) =>
      setValues((prev) => (prev ? { ...prev, [key]: next } : prev)),
    [],
  );

  const dirty = React.useMemo(() => {
    if (!initial || !values) return false;
    const keys = Object.keys(initial) as (keyof FormValues)[];
    return keys.some((k) => {
      if (k === 'venue') return (initial.venue?.id ?? null) !== (values.venue?.id ?? null);
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
    if (!values.headliner.trim()) {
      showToast({ kind: 'error', text: 'Headliner can’t be empty' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
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
      : { name: values.venueQuery.trim() || detail.venue.name, city: detail.venue.city };

    const supports = values.supportActs
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name, i) => ({
        name,
        role: 'support' as const,
        sortOrder: i + 1,
      }));

    const input = {
      showId,
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
    };

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
                seat: input.seat ?? null,
                pricePaid: input.pricePaid ?? null,
                ticketCount: input.ticketCount,
                tourName: input.tourName ?? null,
                productionName: input.productionName ?? (prev as { productionName?: string | null }).productionName ?? null,
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
      const message = err instanceof Error ? err.message : 'Could not save';
      showToast({ kind: 'error', text: message });
    } finally {
      setSaving(false);
    }
  }, [values, detail, queryClient, utils, showId, router, showToast]);

  if (!detail || !values) {
    return (
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
    );
  }

  return (
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
              placeholder="Required"
              autoCapitalize="words"
            />
          </Field>

          <Field label="Venue">
            <VenueTypeahead
              value={values.venueQuery}
              onChange={(v) => {
                set('venueQuery', v);
                if (values.venue && v !== values.venue.name) set('venue', null);
              }}
              onSelect={(venue) => {
                set('venue', venue);
                set('venueQuery', venue.name);
                setVenueResults([]);
              }}
              onSearch={runVenueSearch}
              suggestions={venueResults}
              loading={venueLoading}
              testID="venue-typeahead"
            />
            {values.venue ? (
              <Pressable
                onPress={() => set('venue', null)}
                style={[styles.venuePill, { backgroundColor: colors.accent }]}
              >
                <Text style={[styles.venuePillText, { color: colors.accentText }]}>
                  {values.venue.name}
                </Text>
                <X size={12} color={colors.accentText} strokeWidth={2.4} />
              </Pressable>
            ) : null}
          </Field>

          <Field label="Date">
            <Input
              value={values.date}
              onChangeText={(v) => set('date', v)}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
            />
          </Field>

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
              placeholder="Anything to remember"
              multiline
              numberOfLines={4}
            />
          </Field>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
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

function Input(props: React.ComponentProps<typeof TextInput>): React.JSX.Element {
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
  field: { gap: 6 },
  fieldLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
  },
  row: { flexDirection: 'row', gap: 12 },
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
