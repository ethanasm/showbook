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
 * On success the screen routes back to the Add tab with a
 * `savedShowId` param so the chat screen can render a Groq-summarized
 * confirmation and the user can keep going.
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
import { useQueryClient } from '@tanstack/react-query';

import { TopBar } from '../../components/TopBar';
import {
  ImportSourceBanner,
  type ImportSourceVariant,
} from '../../components/ImportSourceBanner';
import {
  ShowFormFields,
  type ShowFormErrors,
} from '../../components/ShowFormFields';
import { useTheme } from '@/lib/theme';
import { useFormState } from '@/lib/useFormState';
import { trpc } from '@/lib/trpc';
import { useFeedback } from '@/lib/feedback';
import { toUserMessage } from '@/lib/errors';
import { runOptimisticMutation } from '@/lib/mutations';
import { getCacheOutbox, invalidateShowsList } from '@/lib/cache';
import {
  emptyShowFormValues,
  serializeShowFormForKind,
  type PerformerRow,
  type ShowFormKind,
  type ShowFormValues,
} from '@/lib/showForm';
import { newPerformerRowId } from '../../components/LineupEditor';
import { isYmd, normalizeDateInput } from '@/lib/dateInput';
import { useVenueSearch } from '@/lib/useVenueSearch';
import { FestivalPosterHowToSheet } from '../../components/FestivalPosterHowToSheet';

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

/**
 * Decode the `performersJson` URL param the festival-poster flow uses
 * to hand off its confirmed lineup. Defensive — a malformed payload
 * just yields an empty lineup so the form still opens.
 */
function paramPerformers(value: string | string[] | undefined): PerformerRow[] {
  const raw = paramString(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: PerformerRow[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const name = typeof e.name === 'string' ? e.name : '';
      if (!name) continue;
      const tier =
        e.role === 'headliner' || e.tier === 'headliner' ? 'headliner' : 'support';
      out.push({
        id: newPerformerRowId(),
        name,
        tier,
        tmAttractionId:
          typeof e.tmAttractionId === 'string' ? e.tmAttractionId : undefined,
        musicbrainzId:
          typeof e.musicbrainzId === 'string' ? e.musicbrainzId : undefined,
        imageUrl: typeof e.imageUrl === 'string' ? e.imageUrl : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function paramImportSource(
  value: string | string[] | undefined,
): ImportSourceVariant | null {
  return paramString(value) === 'wallet' ? 'wallet' : null;
}

export default function AddFormScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast } = useFeedback();

  // The future-shows search hands over a venue name + city; chat / direct
  // entry only carry a free-text hint. Seed a resolved `venue` object when
  // both are present so the show saves with the right city instead of the
  // "Unknown" placeholder.
  const venueHint = paramString(params.venueHint);
  const venueCity = paramString(params.venueCity);

  const { values, set } = useFormState<ShowFormValues>(
    emptyShowFormValues({
      kind: paramKind(params.kindHint),
      title: paramString(params.headliner),
      venueQuery: venueHint,
      venue: venueHint && venueCity ? { name: venueHint, city: venueCity } : null,
      // Chat hands over a free-form date hint (Groq is asked for ISO
      // but doesn't always comply); normalize on the way in so the
      // field starts in a valid state.
      date: normalizeDateInput(paramString(params.dateHint)),
      // Festival poster passes endDate + performersJson; chat / direct
      // entry leave these blank.
      endDate: normalizeDateInput(paramString(params.endDateHint)),
      seat: paramString(params.seatHint),
      performers: paramPerformers(params.performersJson),
    }),
  );

  const importSource = paramImportSource(params.source);
  const walletSerial = paramString(params.walletSerial);
  const walletPassType = paramString(params.walletPassType);

  const [errors, setErrors] = React.useState<ShowFormErrors>({});
  const clearError = React.useCallback((key: keyof ShowFormErrors) => {
    setErrors((prev) => {
      if (prev[key] === undefined) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const venueSearch = useVenueSearch(utils.client);

  const onSelectPlace = React.useCallback(
    async (placeId: string) => {
      try {
        const created = await venueSearch.resolvePlace(placeId);
        set('venue', {
          id: created.id,
          name: created.name,
          city: created.city,
          stateRegion: created.stateRegion,
          country: created.country,
        });
        set('venueQuery', created.name);
        clearError('venue');
      } catch (err) {
        showToast({
          kind: 'error',
          text: toUserMessage(err, 'Could not load venue details'),
        });
      }
    },
    [venueSearch, set, clearError, showToast],
  );

  const [submitting, setSubmitting] = React.useState(false);
  const [posterSheetOpen, setPosterSheetOpen] = React.useState(false);

  const submit = React.useCallback(async () => {
    // Try to canonicalize the date field one more time at submit
    // time — covers free-text input like "Aug 5, 2018" that the user
    // never explicitly converted. If we can parse it, we write the
    // ISO form back into the field so the user sees what we're
    // sending.
    const normalizedDate = normalizeDateInput(values.date);
    if (normalizedDate !== values.date) set('date', normalizedDate);
    const normalizedEndDate = normalizeDateInput(values.endDate);
    if (normalizedEndDate !== values.endDate) set('endDate', normalizedEndDate);

    const fieldErrors: ShowFormErrors = {};
    if (!values.title.trim()) {
      const label =
        values.kind === 'theatre'
          ? 'production name'
          : values.kind === 'festival'
            ? 'festival name'
            : 'headliner';
      fieldErrors.title = `Add a ${label}`;
    }
    if (!values.venue && !values.venueQuery.trim()) {
      fieldErrors.venue = 'Pick or enter a venue';
    }
    if (!isYmd(normalizedDate)) {
      fieldErrors.date = 'Use YYYY-MM-DD (or “Aug 5, 2018”)';
    }
    if (
      values.kind === 'festival' &&
      values.endDate.trim() &&
      !isYmd(normalizedEndDate)
    ) {
      fieldErrors.endDate = 'Use YYYY-MM-DD (or “Aug 5, 2018”)';
    }
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    const payload = serializeShowFormForKind({
      ...values,
      date: normalizedDate,
      endDate: normalizedEndDate,
    });

    const sourceRefs =
      importSource === 'wallet' && walletSerial
        ? {
            wallet: {
              passTypeIdentifier: walletPassType || null,
              serialNumber: walletSerial,
              importedAt: new Date().toISOString(),
            },
          }
        : undefined;

    setSubmitting(true);
    try {
      const { result } = await runOptimisticMutation<
        Parameters<typeof utils.client.shows.create.mutate>[0],
        void,
        Awaited<ReturnType<typeof utils.client.shows.create.mutate>>
      >({
        mutation: 'shows.create',
        input: { ...payload, sourceRefs },
        outbox: getCacheOutbox(),
        call: (input) => utils.client.shows.create.mutate(input),
        reconcile: () => {
          void utils.shows.list.invalidate();
          invalidateShowsList(queryClient);
        },
      });
      const newId = result?.id;
      if (newId) {
        // Back to the chat tab with the saved show id; the chat
        // screen renders an inline confirmation and offers a deep
        // link into the new show. Routing this way (instead of
        // replacing with /show/<id>) keeps the conversational flow
        // unbroken so the user can dictate another show without
        // navigating back.
        router.replace({ pathname: '/add', params: { savedShowId: newId } });
      } else {
        // Offline save — show landed in the outbox, no id yet. Toast
        // remains useful here because we don't have a chat-side
        // context to land in.
        showToast({ kind: 'success', text: 'Saved offline — will sync' });
        router.back();
      }
    } catch (err) {
      showToast({ kind: 'error', text: toUserMessage(err, 'Could not save show') });
    } finally {
      setSubmitting(false);
    }
  }, [
    values,
    set,
    utils,
    router,
    showToast,
    queryClient,
    importSource,
    walletSerial,
    walletPassType,
  ]);

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
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <NestableScrollContainer
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {importSource ? <ImportSourceBanner variant={importSource} /> : null}
            <ShowFormFields
              values={values}
              set={set}
              venueSuggestions={venueSearch.suggestions}
              venueLoading={venueSearch.loading}
              onVenueSearch={venueSearch.runSearch}
              onSelectPlace={onSelectPlace}
              errors={errors}
              clearError={clearError}
              onExtractLineup={() => setPosterSheetOpen(true)}
            />
          </NestableScrollContainer>
        </KeyboardAvoidingView>
        <FestivalPosterHowToSheet
          open={posterSheetOpen}
          onClose={() => setPosterSheetOpen(false)}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 64,
    gap: 16,
  },
});
