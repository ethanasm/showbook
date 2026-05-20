/**
 * Add show — structured form.
 *
 * Reached from the chat screen with a parsed payload pre-filled into
 * search params, or directly from the "form" affordance on the chat
 * screen with no params (blank form).
 *
 * The form body lives in `components/ShowFormFields` so it's shared
 * with the Edit screen. Submission goes through the optimistic
 * mutation runner so a failed Create survives in the SQLite outbox.
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
import { ChevronLeft, Check } from 'lucide-react-native';
import { NestableScrollContainer } from 'react-native-draggable-flatlist';

import { TopBar } from '../../components/TopBar';
import { ShowFormFields } from '../../components/ShowFormFields';
import type { VenueSuggestion } from '../../components/VenueTypeahead';
import { useTheme } from '../../lib/theme';
import { useFormState } from '../../lib/useFormState';
import { trpc } from '../../lib/trpc';
import { useFeedback } from '../../lib/feedback';
import { toUserMessage } from '../../lib/errors';
import { runOptimisticMutation } from '../../lib/mutations';
import { getCacheOutbox } from '../../lib/cache';
import {
  emptyShowFormValues,
  serializeShowFormForKind,
  type ShowFormKind,
  type ShowFormValues,
} from '../../lib/showForm';

// Hoisted so the `options` reference passed to `<Stack.Screen>` is
// stable across renders. See the inline rationale on `SCREEN_OPTIONS`
// in `show/[id]/edit.tsx` — the same iOS stackPresentation thrash
// surfaced on the chat → form push path.
const SCREEN_OPTIONS = { presentation: 'modal', gestureEnabled: true } as const;

function paramString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function paramKind(value: string | string[] | undefined): ShowFormKind {
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

  const { values, set } = useFormState<ShowFormValues>(
    emptyShowFormValues({
      kind: paramKind(params.kindHint),
      title: paramString(params.headliner),
      venueQuery: paramString(params.venueHint),
      date: paramString(params.dateHint),
      seat: paramString(params.seatHint),
    }),
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
    if (!values.title.trim()) {
      const label =
        values.kind === 'theatre'
          ? 'production name'
          : values.kind === 'festival'
            ? 'festival name'
            : 'headliner';
      showToast({ kind: 'error', text: `Add a ${label}` });
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
    if (values.kind === 'festival' && values.endDate.trim() && !isYmd(values.endDate)) {
      showToast({ kind: 'error', text: 'End date must be YYYY-MM-DD' });
      return;
    }

    const payload = serializeShowFormForKind(values);

    setSubmitting(true);
    try {
      const { result } = await runOptimisticMutation<
        Parameters<typeof utils.client.shows.create.mutate>[0],
        void,
        Awaited<ReturnType<typeof utils.client.shows.create.mutate>>
      >({
        mutation: 'shows.create',
        input: payload,
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
      showToast({ kind: 'error', text: toUserMessage(err, 'Could not save show') });
    } finally {
      setSubmitting(false);
    }
  }, [values, utils, router, showToast]);

  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
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
});
