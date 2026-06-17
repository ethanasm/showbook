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
  Plus,
  Sparkles,
  PenLine,
  Ticket,
  X,
} from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  deriveFollowSuggestions,
  type FollowSeedEntity,
} from '@showbook/shared';

import { TopBar } from '../../components/TopBar';
import { SearchTopBarAction } from '../../components/SearchTopBarAction';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { useFeedback } from '@/lib/feedback';
import { toUserMessage } from '@/lib/errors';
import { runOptimisticMutation } from '@/lib/mutations';
import { getCacheOutbox } from '@/lib/cache';
import { WalletShareHowToSheet } from '../../components/WalletShareHowToSheet';
import { FestivalPosterHowToSheet } from '../../components/FestivalPosterHowToSheet';
import {
  appendRecent,
  isConversationKind,
  type SessionRecentShow,
} from '@/lib/conversationMemory';
import {
  isUpcomingDateHint,
  tmDateWindow,
  tmResultToFormParams,
  type TmChatMatch,
} from '@/lib/chat-tm-match';

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
  const [walletSheetOpen, setWalletSheetOpen] = React.useState(false);
  const [festivalSheetOpen, setFestivalSheetOpen] = React.useState(false);
  const parse = trpc.enrichment.parseChat.useMutation();

  // ---------------------------------------------------------------------------
  // Ticketmaster "did you mean one of these?" picker
  // ---------------------------------------------------------------------------
  // For shows the user is *going* to see, after the parse we search
  // Ticketmaster for matching upcoming events and offer a picker that
  // prefills the form with the venue / date / lineup. Past shows skip
  // this entirely — Ticketmaster's catalogue only exposes upcoming
  // events (`isUpcomingDateHint`). `pendingForm` holds the params we'd
  // route with if the user picks "None of these", so the manual path
  // still carries everything the LLM parsed.
  const [tmMatches, setTmMatches] = React.useState<TmChatMatch[] | null>(null);
  const [tmSearching, setTmSearching] = React.useState(false);
  const [pendingForm, setPendingForm] = React.useState<{
    baseParams: Record<string, string>;
    seatHint: string;
    freeText: string;
  } | null>(null);

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
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = React.useState<{
    showId: string;
    message: string;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Follow seeding
  // ---------------------------------------------------------------------------
  // The saved show names exactly the artist and venue the user cares
  // about — offer one-tap follows in the confirmation card so Discover
  // stops being a cold start. Chips are derived from the canonical
  // show detail (post-matchOrCreate*) minus anything already followed.
  type FollowChip = FollowSeedEntity & {
    type: 'performer' | 'venue';
    state: 'idle' | 'pending' | 'done';
  };
  const [followSeed, setFollowSeed] = React.useState<{
    showId: string;
    chips: FollowChip[];
  } | null>(null);

  const handleFollowChip = React.useCallback(
    async (chip: FollowChip) => {
      const setChipState = (state: FollowChip['state']) =>
        setFollowSeed((prev) =>
          prev
            ? {
                ...prev,
                chips: prev.chips.map((c) =>
                  c.type === chip.type ? { ...c, state } : c,
                ),
              }
            : prev,
        );
      setChipState('pending');
      const followedKey =
        chip.type === 'performer'
          ? ['mobile', 'artists', 'followed']
          : ['mobile', 'venues', 'followed'];
      // Shared optimistic wiring — append the followed row so the
      // Discover rail / checklist see the follow before the refetch.
      const optimistic = {
        snapshot: () => queryClient.getQueryData<{ id: string }[]>(followedKey),
        apply: () => {
          queryClient.setQueryData<{ id: string }[]>(followedKey, (prev) => {
            const list = prev ?? [];
            if (list.some((row) => row.id === chip.id)) return list;
            return [...list, { id: chip.id }];
          });
        },
        rollback: (snap: { id: string }[] | undefined) =>
          queryClient.setQueryData(followedKey, snap),
      };
      try {
        if (chip.type === 'performer') {
          await runOptimisticMutation({
            mutation: 'performers.follow',
            input: { performerId: chip.id },
            outbox: getCacheOutbox(),
            call: (input) => utils.client.performers.follow.mutate(input),
            optimistic,
            reconcile: () => {
              void utils.performers.followed.invalidate();
            },
          });
        } else {
          await runOptimisticMutation({
            mutation: 'venues.follow',
            input: { venueId: chip.id },
            outbox: getCacheOutbox(),
            call: (input) => utils.client.venues.follow.mutate(input),
            optimistic,
            reconcile: () => {
              void utils.venues.followed.invalidate();
            },
          });
        }
        setChipState('done');
      } catch (err) {
        setChipState('idle');
        showToast({
          kind: 'error',
          text: toUserMessage(err, `Couldn't follow ${chip.name} — try again`),
        });
      }
    },
    [queryClient, utils, showToast],
  );

  React.useEffect(() => {
    const savedShowId = paramString(params.savedShowId);
    if (!savedShowId) return;
    if (confirmation && confirmation.showId === savedShowId) return;

    setConfirmation({
      showId: savedShowId,
      message: 'Saved. Polishing the recap…',
    });
    setFollowSeed(null);
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
      .then(async (detail) => {
        if (!detail) return;

        // Follow seeding — best-effort: filter the headliner / venue
        // against what's already followed and surface the rest as
        // one-tap chips on the confirmation card.
        try {
          const [followedPerformers, followedVenues] = await Promise.all([
            utils.client.performers.followed.query().catch(() => []),
            utils.client.venues.followed.query().catch(() => []),
          ]);
          const suggestions = deriveFollowSuggestions(detail, {
            followedPerformerIds: followedPerformers.map((p) => p.id),
            followedVenueIds: followedVenues.map((v) => v.id),
          });
          const chips: FollowChip[] = [];
          if (suggestions.performer) {
            chips.push({ ...suggestions.performer, type: 'performer', state: 'idle' });
          }
          if (suggestions.venue) {
            chips.push({ ...suggestions.venue, type: 'venue', state: 'idle' });
          }
          if (chips.length > 0) {
            setFollowSeed({ showId: savedShowId, chips });
          }
        } catch {
          // No chips — the confirmation card still works without them.
        }

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

  const routeToForm = React.useCallback(
    (params: Record<string, string>) => {
      router.push({ pathname: '/add/form', params });
    },
    [router],
  );

  // Picked a Ticketmaster match — drop into the form prefilled with the
  // event's venue / date / lineup, carrying over the seat the user
  // mentioned and the original free text.
  const handleSelectMatch = React.useCallback(
    (match: TmChatMatch) => {
      const seatHint = pendingForm?.seatHint ?? '';
      const freeText = pendingForm?.freeText ?? '';
      setTmMatches(null);
      setPendingForm(null);
      setText('');
      routeToForm({ ...tmResultToFormParams(match), seatHint, freeText });
    },
    [pendingForm, routeToForm],
  );

  // "None of these" — fall back to the plain parsed details, exactly as
  // the chat flow behaved before the Ticketmaster picker existed.
  const handleRejectMatches = React.useCallback(() => {
    const baseParams = pendingForm?.baseParams;
    setTmMatches(null);
    setPendingForm(null);
    setText('');
    if (baseParams) routeToForm(baseParams);
  }, [pendingForm, routeToForm]);

  const submit = React.useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;
      // Sending a new message clears the previous confirmation card and
      // any stale Ticketmaster picker — the user is moving on.
      setConfirmation(null);
      setFollowSeed(null);
      setTmMatches(null);
      setPendingForm(null);
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

        // Params we'd route with absent a Ticketmaster match — the
        // chat flow's original behavior, reused for past shows and the
        // picker's "None of these" fallback.
        const baseParams: Record<string, string> = {
          headliner: parsed.headliner ?? '',
          venueHint: parsed.venue_hint ?? '',
          dateHint: parsed.date_hint ?? '',
          seatHint: parsed.seat_hint ?? '',
          kindHint: parsed.kind_hint ?? '',
          freeText: trimmed,
        };

        // Only upcoming shows live in Ticketmaster's catalogue — gate
        // the lookup on a parsed headliner + a today-or-later date so
        // past shows go straight to the form.
        if (parsedHeadliner && isUpcomingDateHint(parsed.date_hint)) {
          setTmSearching(true);
          try {
            const { startDate, endDate } = tmDateWindow(parsed.date_hint);
            const matches = (await utils.client.enrichment.searchTM.query({
              headliner: parsedHeadliner,
              startDate,
              endDate,
            })) as TmChatMatch[];
            if (matches.length > 0) {
              setPendingForm({
                baseParams,
                seatHint: parsed.seat_hint ?? '',
                freeText: trimmed,
              });
              setTmMatches(matches);
              setText('');
              return; // wait for the user to pick a match or dismiss
            }
          } catch {
            // TM lookup is best-effort — fall through to the plain form.
          } finally {
            setTmSearching(false);
          }
        }

        setText('');
        routeToForm(baseParams);
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
    [parse, router, routeToForm, utils, showToast],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title="Add"
        eyebrow="LOG · IMPORT · WATCH"
        large
        rightAction={
          <View style={styles.headerActions}>
            <SearchTopBarAction />
            <Pressable
              onPress={() => router.push('/add/form')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Open form"
            >
              <PenLine size={20} color={colors.muted} strokeWidth={2} />
            </Pressable>
          </View>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollPad}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
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
                {followSeed &&
                followSeed.showId === confirmation.showId &&
                followSeed.chips.length > 0 ? (
                  <View style={styles.followSeed}>
                    <Text style={[styles.followSeedHint, { color: colors.muted }]}>
                      Catch the next one — announcements land in Discover.
                    </Text>
                    <View style={styles.followSeedChips}>
                      {followSeed.chips.map((chip) => (
                        <Pressable
                          key={chip.type}
                          onPress={() => void handleFollowChip(chip)}
                          disabled={chip.state !== 'idle'}
                          accessibilityRole="button"
                          accessibilityLabel={
                            chip.state === 'done'
                              ? `Following ${chip.name}`
                              : `Follow ${chip.name}`
                          }
                          testID={`follow-seed-${chip.type}`}
                          style={({ pressed }) => [
                            styles.followSeedChip,
                            {
                              borderColor:
                                chip.state === 'done' ? colors.accent : colors.rule,
                              opacity:
                                chip.state === 'pending' ? 0.5 : pressed ? 0.7 : 1,
                            },
                          ]}
                        >
                          {chip.state === 'done' ? (
                            <Check size={12} color={colors.accent} strokeWidth={2.6} />
                          ) : (
                            <Plus size={12} color={colors.ink} strokeWidth={2.4} />
                          )}
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.followSeedChipLabel,
                              {
                                color:
                                  chip.state === 'done' ? colors.accent : colors.ink,
                              },
                            ]}
                          >
                            {chip.state === 'done'
                              ? `Following ${chip.name}`
                              : `Follow ${chip.name}`}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
              <Pressable
                onPress={() => {
                  setConfirmation(null);
                  setFollowSeed(null);
                }}
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

          {tmSearching ? (
            <View style={styles.tmSearching}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={[styles.tmSearchingText, { color: colors.muted }]}>
                Checking Ticketmaster…
              </Text>
            </View>
          ) : null}

          {tmMatches && tmMatches.length > 0 ? (
            <View style={styles.tmSection}>
              <Text style={[styles.tmHeading, { color: colors.muted }]}>
                Found these on Ticketmaster — pick one to prefill the form, or
                enter it yourself.
              </Text>
              {tmMatches.map((m) => (
                <Pressable
                  key={m.tmEventId}
                  onPress={() => handleSelectMatch(m)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${m.name} from Ticketmaster`}
                  testID="chat-tm-match"
                  style={({ pressed }) => [
                    styles.posterDoor,
                    {
                      borderColor: colors.rule,
                      backgroundColor: colors.surface,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <View
                    style={[styles.posterIcon, { backgroundColor: colors.surfaceRaised }]}
                  >
                    <Ticket size={18} color={colors.accent} strokeWidth={1.8} />
                  </View>
                  <View style={styles.posterBody}>
                    <Text
                      numberOfLines={1}
                      style={[styles.posterTitle, { color: colors.ink }]}
                    >
                      {m.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.posterSub, { color: colors.muted }]}
                    >
                      {[m.venueName, m.venueCity, m.date].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={colors.faint} strokeWidth={2} />
                </Pressable>
              ))}
              <Pressable
                onPress={handleRejectMatches}
                accessibilityRole="button"
                accessibilityLabel="None of these — enter the show manually"
                testID="chat-tm-reject"
                style={({ pressed }) => [styles.tmReject, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.tmRejectText, { color: colors.accent }]}>
                  None of these — enter manually
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!tmMatches && (
            <>
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

          {/* Manual-entry door — same destination as the pen icon in the
              top bar, surfaced as a full door so form-first users don't
              have to discover the chat is skippable. */}
          <Pressable
            onPress={() => router.push('/add/form')}
            accessibilityRole="button"
            accessibilityLabel="Add a show manually"
            testID="add-manual-entry"
            style={({ pressed }) => [
              styles.posterDoor,
              { borderColor: colors.rule, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View style={[styles.posterIcon, { backgroundColor: colors.surfaceRaised }]}>
              <PenLine size={18} color={colors.accent} strokeWidth={1.8} />
            </View>
            <View style={styles.posterBody}>
              <Text style={[styles.posterTitle, { color: colors.ink }]}>
                Add a show manually
              </Text>
              <Text style={[styles.posterSub, { color: colors.muted }]}>
                Skip the chat — fill in the form yourself.
              </Text>
            </View>
            <ArrowRight size={16} color={colors.faint} strokeWidth={2} />
          </Pressable>

          {/* Festival poster door — opens a how-to sheet that runs the
              picker inline (mirrors the Apple Wallet door). On a successful
              pick the sheet stashes the image via posterHandoff and pushes
              to /add/festival-poster, which jumps straight to extracting. */}
          <Pressable
            onPress={() => setFestivalSheetOpen(true)}
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

          {/* Apple Wallet door — the importer itself is share-sheet-only
              (the .pkpass document-type registration in app.config.ts adds
              Showbook to iOS's share sheet for pass files). This door is
              pure discovery/education: tapping it explains the flow rather
              than launching a picker. iOS-only: Google Wallet on Android
              doesn't expose pass data to share into apps, so the door is
              hidden there rather than offering an import that can't run. */}
          {Platform.OS === 'ios' && (
          <Pressable
            onPress={() => setWalletSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Import a ticket from Apple Wallet"
            testID="add-wallet-import"
            style={({ pressed }) => [
              styles.posterDoor,
              { borderColor: colors.rule, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View style={[styles.posterIcon, { backgroundColor: colors.surfaceRaised }]}>
              <Ticket size={18} color={colors.accent} strokeWidth={1.8} />
            </View>
            <View style={styles.posterBody}>
              <Text style={[styles.posterTitle, { color: colors.ink }]}>
                Import from Apple Wallet
              </Text>
              <Text style={[styles.posterSub, { color: colors.muted }]}>
                Share a .pkpass to Showbook and we&rsquo;ll pre-fill the form.
              </Text>
            </View>
            <ArrowRight size={16} color={colors.faint} strokeWidth={2} />
          </Pressable>
          )}
            </>
          )}
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
            editable={!parse.isPending && !tmSearching}
          />
          <Pressable
            onPress={() => void submit(text)}
            disabled={parse.isPending || tmSearching || text.trim().length === 0}
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
            {parse.isPending || tmSearching ? (
              <ActivityIndicator size="small" color={colors.accentText} />
            ) : (
              <ArrowRight size={18} color={colors.accentText} strokeWidth={2.4} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <WalletShareHowToSheet
        open={walletSheetOpen}
        onClose={() => setWalletSheetOpen(false)}
      />
      <FestivalPosterHowToSheet
        open={festivalSheetOpen}
        onClose={() => setFestivalSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
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
  tmSearching: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tmSearchingText: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
  },
  tmSection: {
    gap: 8,
  },
  tmHeading: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    lineHeight: 18,
  },
  tmReject: {
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  tmRejectText: {
    fontFamily: 'Geist Sans 600',
    fontSize: 13,
  },
  suggestion: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.md,
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
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterDoor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.lg,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  posterIcon: {
    width: 36,
    height: 36,
    borderRadius: RADII.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  posterTitle: {
    fontFamily: 'Geist Sans 600',
    fontSize: 14,
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
    borderRadius: RADII.lg,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  confirmIcon: {
    width: 28,
    height: 28,
    borderRadius: RADII.pill,
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
    fontFamily: 'Geist Sans 600',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  confirmDismiss: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  followSeed: {
    gap: 8,
    marginTop: 2,
  },
  followSeedHint: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    lineHeight: 16,
  },
  followSeedChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  followSeedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1,
    borderRadius: RADII.pill,
    maxWidth: 240,
  },
  followSeedChipLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 12,
    flexShrink: 1,
  },
});
