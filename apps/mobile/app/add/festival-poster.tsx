/**
 * Festival poster — pick an image, OCR the lineup via the Groq-backed
 * `enrichment.extractFestivalLineup` mutation, let the user trim /
 * reorder / rename the lineup, then hand off to `/add/form` with all
 * the extracted data pre-populated so the user can edit the festival
 * name and venue before the actual `shows.create` call.
 *
 * Phases (driven by `useFestivalLineup`):
 *   idle       — splash with "Pick a poster" CTA + a hint about what
 *                gets extracted
 *   extracting — spinner + progress copy
 *   picking    — `FestivalLineupPicker` with the artists list
 *   submitting — disabled UI while we serialize + navigate
 *   done       — handled inline (we've already replaced into the form
 *                route)
 *   error      — extraction error banner + "Try again" CTA
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Image as ExpoImage } from 'expo-image';
import { ChevronLeft, Image as ImageIcon, RefreshCcw } from 'lucide-react-native';

import { TopBar } from '../../components/TopBar';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { useFeedback } from '@/lib/feedback';
import {
  useFestivalLineup,
  type FestivalLineupMeta,
  type SelectedFestivalArtist,
} from '@/lib/festival-lineup/useFestivalLineup';
import { parseFestivalVenue } from '@/lib/festival-lineup/parseFestivalVenue';
import {
  pickFestivalImage,
  type PickedFestivalImage,
} from '@/lib/festival-lineup/pickFestivalImage';
import { consumePendingFestivalPoster } from '@/lib/festival-lineup/posterHandoff';
import { FestivalLineupPicker } from '../../components/festival-lineup/FestivalLineupPicker';
import { Eyebrow, GlowBackdrop } from '../../components/design-system';

// Hoisted so the `options` reference passed to `<Stack.Screen>` is
// stable across renders. See the same constant in `apps/mobile/app/add/form.tsx`
// for the iOS re-mount cascade this prevents.
const SCREEN_OPTIONS = { presentation: 'modal', gestureEnabled: true } as const;

export default function FestivalPosterScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showToast } = useFeedback();
  const [poster, setPoster] = React.useState<PickedFestivalImage | null>(null);

  const handleSubmit = React.useCallback(
    async (artists: SelectedFestivalArtist[], meta: FestivalLineupMeta) => {
      if (artists.length === 0) {
        throw new Error('Select at least one artist');
      }

      // Don't create the show here — hand off to /add/form with
      // everything pre-populated so the user can edit the festival
      // name + venue before saving. The form route knows how to
      // hydrate from these params (see paramPerformers there).
      const productionName = meta.festivalName?.trim() ?? '';
      const venuePayload = parseFestivalVenue(meta);

      const performersJson = JSON.stringify(
        artists.map((a) => ({
          name: a.name,
          role: a.role,
          tmAttractionId: a.tmAttractionId,
          musicbrainzId: a.musicbrainzId,
          imageUrl: a.imageUrl,
        })),
      );

      router.replace({
        pathname: '/add/form',
        params: {
          kindHint: 'festival',
          headliner: productionName,
          venueHint: venuePayload.name,
          dateHint: meta.startDate ?? '',
          endDateHint: meta.endDate ?? '',
          performersJson,
        },
      });
    },
    [router],
  );

  const flow = useFestivalLineup({ onSubmit: handleSubmit });

  // Sheet-driven entry: the Add tab's FestivalPosterHowToSheet runs the
  // picker before navigating here and stashes the result. Consume it on
  // mount so we land directly in the extracting phase.
  React.useEffect(() => {
    const pending = consumePendingFestivalPoster();
    if (!pending) return;
    setPoster(pending);
    void flow.extractFromSource({ base64: pending.base64, kind: 'image' });
    // Run once per mount; flow identity is stable for the lifetime of
    // this screen so the missing-dep is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickPoster = React.useCallback(async () => {
    const res = await pickFestivalImage();
    if (res.permissionDenied) {
      showToast({
        kind: 'error',
        text: 'Photos permission is required to upload a poster.',
      });
      return;
    }
    if (res.cancelled || !res.image) return;
    setPoster(res.image);
    void flow.extractFromSource({ base64: res.image.base64, kind: 'image' });
  }, [flow, showToast]);

  const tryAgain = React.useCallback(() => {
    setPoster(null);
    flow.reset();
  }, [flow]);

  const back = (
    <Pressable
      onPress={() => router.back()}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Cancel"
    >
      <ChevronLeft size={22} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  const isPicking = flow.phase === 'picking' || flow.phase === 'submitting';
  const isExtracting = flow.phase === 'extracting';
  const isError = flow.phase === 'error';
  const isIdle = flow.phase === 'idle';
  const submitDisabled = flow.selected.size === 0 || flow.phase === 'submitting';

  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <TopBar
          title={flow.meta?.festivalName ?? 'Festival poster'}
          eyebrow="UPLOAD · OCR · CONFIRM"
          leading={back}
        />

        {isIdle ? (
          <IdleSplash onPick={pickPoster} />
        ) : isExtracting ? (
          <ExtractingState posterUri={poster?.uri ?? null} />
        ) : isError ? (
          <ErrorState message={flow.error} onRetry={tryAgain} />
        ) : isPicking ? (
          <FestivalLineupPicker flow={flow} />
        ) : null}

        {isPicking ? (
          <View
            style={[
              styles.footer,
              {
                borderTopColor: colors.rule,
                backgroundColor: colors.surface,
                paddingBottom: 12 + insets.bottom,
              },
            ]}
          >
            <View style={styles.footerMeta}>
              <Text style={[styles.footerCount, { color: colors.muted }]}>
                {flow.selected.size > 0 ? (
                  <>
                    <Text style={{ color: colors.accent, fontWeight: '600' }}>
                      {flow.selected.size}
                    </Text>{' '}
                    selected
                  </>
                ) : (
                  'None selected'
                )}
              </Text>
              {flow.meta?.startDate ? (
                <Text style={[styles.footerDate, { color: colors.faint }]}>
                  {flow.meta.startDate}
                  {flow.meta.endDate && flow.meta.endDate !== flow.meta.startDate
                    ? ` → ${flow.meta.endDate}`
                    : ''}
                </Text>
              ) : null}
            </View>
            {flow.error ? (
              <Text style={[styles.footerError, { color: colors.danger }]} numberOfLines={2}>
                {flow.error}
              </Text>
            ) : null}
            <Pressable
              onPress={() => void flow.submit()}
              disabled={submitDisabled}
              accessibilityRole="button"
              accessibilityLabel="Review and save festival"
              style={({ pressed }) => [
                styles.saveBtn,
                {
                  backgroundColor: colors.accent,
                  opacity: submitDisabled ? 0.4 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {flow.phase === 'submitting' ? (
                <ActivityIndicator size="small" color={colors.accentText} />
              ) : (
                <Text style={[styles.saveLabel, { color: colors.accentText }]}>
                  Review & save
                </Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </>
  );
}

function IdleSplash({ onPick }: { onPick: () => void }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View style={styles.splash}>
      <GlowBackdrop />
      <View style={styles.splashContent}>
        <Eyebrow>FESTIVAL · LINEUP · POSTER</Eyebrow>
        <Text style={[styles.splashTitle, { color: colors.ink }]}>
          Read a poster, get the lineup
        </Text>
        <Text style={[styles.splashBody, { color: colors.muted }]}>
          Upload a festival poster and we&apos;ll extract the artists, festival name, dates,
          and venue. Tweak the list before saving — anything we miss, you can add by hand.
        </Text>
        <Pressable
          onPress={onPick}
          accessibilityRole="button"
          accessibilityLabel="Pick a poster image"
          style={({ pressed }) => [
            styles.splashBtn,
            { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <ImageIcon size={16} color={colors.accentText} strokeWidth={2} />
          <Text style={[styles.splashBtnLabel, { color: colors.accentText }]}>
            Pick a poster
          </Text>
        </Pressable>
        <Text style={[styles.splashHint, { color: colors.faint }]}>
          JPG / PNG / HEIC, up to ~10 MB. Image only for now — PDF schedules will land later.
        </Text>
      </View>
    </View>
  );
}

function ExtractingState({ posterUri }: { posterUri: string | null }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View style={styles.extracting}>
      {posterUri ? (
        <ExpoImage
          source={{ uri: posterUri }}
          style={styles.extractingPoster}
          contentFit="contain"
          transition={200}
        />
      ) : null}
      <ActivityIndicator color={colors.accent} />
      <Text style={[styles.extractingTitle, { color: colors.ink }]}>
        Reading poster…
      </Text>
      <Text style={[styles.extractingBody, { color: colors.muted }]}>
        Pulling artist names, festival metadata, and matching against Ticketmaster.
        Usually 5–10 seconds.
      </Text>
    </View>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View style={styles.error}>
      <Text style={[styles.errorTitle, { color: colors.ink }]}>
        Couldn&apos;t read that poster
      </Text>
      <Text style={[styles.errorBody, { color: colors.muted }]}>
        {message ?? 'The extractor returned no usable lineup. Try a sharper image.'}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try a different poster"
        style={({ pressed }) => [
          styles.errorBtn,
          { borderColor: colors.ruleStrong, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <RefreshCcw size={14} color={colors.ink} strokeWidth={2} />
        <Text style={[styles.errorBtnLabel, { color: colors.ink }]}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    position: 'relative',
  },
  splashContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 32,
    gap: 12,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  splashTitle: {
    fontFamily: 'Fraunces',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.4,
    maxWidth: 320,
    marginTop: 4,
  },
  splashBody: {
    fontFamily: 'Geist Sans',
    fontSize: 14.5,
    lineHeight: 21,
    maxWidth: 340,
  },
  splashBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: RADII.pill,
    marginTop: 8,
  },
  splashBtnLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
  },
  splashHint: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
    marginTop: 4,
  },
  extracting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  extractingPoster: {
    width: 160,
    height: 220,
    borderRadius: RADII.md,
    marginBottom: 8,
  },
  extractingTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 17,
    fontWeight: '600',
  },
  extractingBody: {
    fontFamily: 'Geist Sans',
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 280,
  },
  error: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  errorTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 17,
    fontWeight: '600',
  },
  errorBody: {
    fontFamily: 'Geist Sans',
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 280,
  },
  errorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  errorBtnLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerMeta: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  footerCount: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  footerDate: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
  },
  footerError: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  saveBtn: {
    paddingVertical: 12,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
  },
});
