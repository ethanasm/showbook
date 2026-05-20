/**
 * Add — chat-first entry point.
 *
 * The user types free text describing a show ("Phoebe Bridgers at the
 * Greek 8/15 GA"); the LLM at `enrichment.parseChat` extracts a
 * structured payload that we route to the form for confirmation.
 *
 * Errors fall through to the form with whatever raw text the user
 * entered — they can always finish by hand. The chat surface is a
 * convenience, never a hard dependency.
 *
 * When the form saves successfully, it routes back here with a
 * `savedShowId` param. We render a confirmation card (Groq-summarized
 * with a deterministic fallback) above the suggestions so the user
 * can describe another show without losing context.
 */

import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Image as ImageIcon,
  Sparkles,
  PenLine,
  X,
} from 'lucide-react-native';

import { TopBar } from '../../components/TopBar';
import { useTheme } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { useFeedback } from '../../lib/feedback';
import { toUserMessage } from '../../lib/errors';
import {
  appendRecent,
  isConversationKind,
  type SessionRecentShow,
} from '../../lib/conversationMemory';

const SUGGESTIONS = [
  'Phoebe Bridgers at the Greek 8/15 GA',
  'Hadestown at Walter Kerr Aug 14 8pm',
  'Tyler the Creator MSG Sep 22 sec 224',
];

function paramString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function AddChatScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { showToast } = useFeedback();

  const [text, setText] = React.useState('');
  const parse = trpc.enrichment.parseChat.useMutation();

  // ---------------------------------------------------------------------------
  // Conversation memory
  // ---------------------------------------------------------------------------
  // Tracks the last few shows the user has discussed in this session
  // so follow-ups like "I also saw him October 23, 2016" can resolve
  // "him" to the most recent headliner via the parseChat context. The
  // buffer survives navigation between the chat tab and the form
  // modal (component stays mounted), and resets when the chat tab
  // unmounts — so memory doesn't bleed across cold launches or
  // sign-outs.
  const [sessionRecent, setSessionRecent] = React.useState<SessionRecentShow[]>([]);
  // Mirror the buffer into a ref so `submit` reads the freshest value
  // without re-creating its useCallback identity on every entry — the
  // chat composer's onPress would otherwise close over a stale array.
  const sessionRecentRef = React.useRef<SessionRecentShow[]>([]);
  sessionRecentRef.current = sessionRecent;

  // ---------------------------------------------------------------------------
  // Saved-show confirmation card
  // ---------------------------------------------------------------------------
  // The form routes back with ?savedShowId=<id> after a successful
  // create. We capture the id once into local state, immediately
  // clear it from the route so a tab re-focus doesn't re-trigger the
  // card, then fire the Groq summary in the background. The
  // deterministic fallback shows up first; the richer message swaps
  // in when the round-trip resolves.
  const summarize = trpc.enrichment.summarizeShowSaved.useMutation();
  const utils = trpc.useUtils();
  const [confirmation, setConfirmation] = React.useState<{
    showId: string;
    message: string;
  } | null>(null);

  React.useEffect(() => {
    const savedShowId = paramString(params.savedShowId);
    if (!savedShowId) return;
    if (confirmation && confirmation.showId === savedShowId) return;

    setConfirmation({
      showId: savedShowId,
      message: 'Saved. Polishing the recap…',
    });
    // Strip the param so a later focus / re-mount doesn't re-fire.
    router.setParams({ savedShowId: '' });

    summarize
      .mutateAsync({ showId: savedShowId })
      .then((res) => {
        setConfirmation((prev) =>
          prev && prev.showId === savedShowId
            ? { showId: savedShowId, message: res.message }
            : prev,
        );
      })
      .catch(() => {
        // Best-effort: leave the optimistic copy in place. The user
        // can still tap to open the show or send the next message.
      });

    // Pull the saved show into the conversation-memory buffer so
    // pronoun follow-ups work. We use the canonical record from the
    // server (post-matchOrCreate*) rather than re-deriving from the
    // chat history — the form may have edited the headliner / venue
    // before save, and we want the *truth* in context, not the
    // user's first guess.
    utils.client.shows.detail
      .query({ showId: savedShowId })
      .then((detail) => {
        if (!detail) return;
        const performers = [...(detail.showPerformers ?? [])].sort(
          (a, b) => a.sortOrder - b.sortOrder,
        );
        const headlinerName =
          detail.productionName ??
          performers.find((p) => p.role === 'headliner')?.performer.name ??
          '';
        if (!headlinerName) return;
        setSessionRecent((prev) =>
          appendRecent(prev, {
            headliner: headlinerName,
            date: detail.date,
            venue: detail.venue?.name ?? null,
            kind: isConversationKind(detail.kind) ? detail.kind : null,
          }),
        );
      })
      .catch(() => {
        // Best-effort enrichment — if the detail fetch fails the
        // optimistic parse-time entry (added in `submit` below) is
        // still in the buffer.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.savedShowId]);

  const submit = React.useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;
      // Sending a new message clears the previous confirmation card —
      // the user is moving on, so the recap shouldn't hang around.
      setConfirmation(null);
      try {
        const parsed = await parse.mutateAsync({
          freeText: trimmed,
          // Pass the in-session memory so the server can resolve
          // pronouns ("him", "her") and shorthand ("also", "again")
          // to a previously named headliner.
          recentShows: sessionRecentRef.current.length > 0
            ? sessionRecentRef.current
            : undefined,
        });
        // Optimistically append the parsed headliner so a follow-up
        // *within the same parse-but-not-yet-saved branch* (user
        // dismisses the form and immediately types again) still has
        // context. The detail-fetch effect above will replace this
        // with a canonical entry once the form is actually saved.
        // Hoist headliner into a const so the narrowing survives the
        // setState callback closure — `parsed.headliner` is `string | null`
        // (post-#286), and TS won't carry the truthy narrow through the
        // closure boundary on its own.
        const parsedHeadliner = parsed.headliner;
        if (parsedHeadliner) {
          setSessionRecent((prev) =>
            appendRecent(prev, {
              headliner: parsedHeadliner,
              date: parsed.date_hint,
              venue: parsed.venue_hint,
              kind: isConversationKind(parsed.kind_hint) ? parsed.kind_hint : null,
            }),
          );
        }
        router.push({
          pathname: '/add/form',
          params: {
            headliner: parsed.headliner ?? '',
            venueHint: parsed.venue_hint ?? '',
            dateHint: parsed.date_hint ?? '',
            seatHint: parsed.seat_hint ?? '',
            kindHint: parsed.kind_hint ?? '',
            freeText: trimmed,
          },
        });
      } catch (err) {
        // toUserMessage swallows internal blobs (Zod / SQL / Groq schema
        // failures) and falls back to a clean message so the toast can't
        // overflow the screen with a JSON dump.
        const message = toUserMessage(
          err,
          'Couldn’t make sense of that — open the form to enter it manually.',
        );
        showToast({
          kind: 'error',
          text: message,
          action: {
            label: 'Form',
            onPress: () =>
              router.push({ pathname: '/add/form', params: { freeText: trimmed } }),
          },
        });
      }
    },
    [parse, router, showToast],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title="Add"
        eyebrow="LOG · IMPORT · WATCH"
        large
        rightAction={
          <Pressable
            onPress={() => router.push('/add/form')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Open form"
          >
            <PenLine size={20} color={colors.muted} strokeWidth={2} />
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollPad}
          keyboardShouldPersistTaps="handled"
        >
          {confirmation ? (
            <View
              style={[
                styles.confirmCard,
                { borderColor: colors.rule, backgroundColor: colors.surface },
              ]}
              testID="add-saved-confirmation"
            >
              <View
                style={[
                  styles.confirmIcon,
                  { backgroundColor: colors.accentFaded },
                ]}
              >
                <Check size={14} color={colors.accent} strokeWidth={2.6} />
              </View>
              <View style={styles.confirmBody}>
                <Text style={[styles.confirmText, { color: colors.ink }]}>
                  {confirmation.message}
                </Text>
                <View style={styles.confirmActions}>
                  <Pressable
                    onPress={() => router.push(`/show/${confirmation.showId}`)}
                    accessibilityRole="button"
                    accessibilityLabel="Open the show I just added"
                    style={({ pressed }) => [
                      styles.confirmAction,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={[styles.confirmActionText, { color: colors.accent }]}>
                      Open show
                    </Text>
                    <ChevronRight size={12} color={colors.accent} strokeWidth={2.4} />
                  </Pressable>
                </View>
              </View>
              <Pressable
                onPress={() => setConfirmation(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
                style={({ pressed }) => [
                  styles.confirmDismiss,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <X size={14} color={colors.faint} strokeWidth={2} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.intro}>
              <Sparkles size={20} color={colors.accent} strokeWidth={1.6} />
              <Text style={[styles.introTitle, { color: colors.ink }]}>
                Just describe the show
              </Text>
              <Text style={[styles.introBody, { color: colors.muted }]}>
                Headliner, venue, date — any order, any abbreviation. We’ll fill in
                the rest and let you tweak it.
              </Text>
            </View>
          )}

          <View style={styles.suggestions}>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setText(s)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.suggestion,
                  { borderColor: colors.rule, backgroundColor: colors.surface },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.suggestionText, { color: colors.muted }]}>{s}</Text>
              </Pressable>
            ))}
          </View>

          {/* Festival poster door — read a lineup off an image and turn it
              into a festival show in one tap. Sits below the chat suggestions
              so it doesn't compete with the primary chat affordance, but
              stays above the fold on a mobile viewport. */}
          <Pressable
            onPress={() => router.push('/add/festival-poster')}
            accessibilityRole="button"
            accessibilityLabel="Upload a festival poster"
            testID="add-festival-poster"
            style={({ pressed }) => [
              styles.posterDoor,
              { borderColor: colors.rule, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View style={[styles.posterIcon, { backgroundColor: colors.surfaceRaised }]}>
              <ImageIcon size={18} color={colors.accent} strokeWidth={1.8} />
            </View>
            <View style={styles.posterBody}>
              <Text style={[styles.posterTitle, { color: colors.ink }]}>
                Upload a festival poster
              </Text>
              <Text style={[styles.posterSub, { color: colors.muted }]}>
                Reads the lineup, festival name, and dates — you trim the list.
              </Text>
            </View>
            <ArrowRight size={16} color={colors.faint} strokeWidth={2} />
          </Pressable>
        </ScrollView>

        <View
          style={[
            styles.composer,
            {
              borderTopColor: colors.rule,
              backgroundColor: colors.surface,
              paddingBottom: 12 + insets.bottom,
            },
          ]}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Describe the show…"
            placeholderTextColor={colors.faint}
            multiline
            style={[styles.composerInput, { color: colors.ink }]}
            editable={!parse.isPending}
          />
          <Pressable
            onPress={() => void submit(text)}
            disabled={parse.isPending || text.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: text.trim().length > 0 ? colors.accent : colors.rule,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            {parse.isPending ? (
              <ActivityIndicator size="small" color={colors.accentText} />
            ) : (
              <ArrowRight size={18} color={colors.accentText} strokeWidth={2.4} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollPad: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
    gap: 24,
  },
  intro: {
    gap: 8,
  },
  introTitle: {
    fontFamily: 'Fraunces',
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 26,
    marginTop: 4,
  },
  introBody: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    lineHeight: 20,
  },
  suggestions: {
    gap: 8,
  },
  suggestion: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  suggestionText: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    lineHeight: 18,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    fontFamily: 'Geist Sans',
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterDoor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  posterIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  posterTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
  },
  posterSub: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    lineHeight: 16,
  },
  confirmCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  confirmIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  confirmBody: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  confirmText: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    lineHeight: 19,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  confirmActionText: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  confirmDismiss: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
});
