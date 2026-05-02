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
import { useRouter } from 'expo-router';
import { ArrowRight, Sparkles, PenLine } from 'lucide-react-native';

import { TopBar } from '../../components/TopBar';
import { useTheme } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { useFeedback } from '../../lib/feedback';

const SUGGESTIONS = [
  'Phoebe Bridgers at the Greek 8/15 GA',
  'Hadestown at Walter Kerr Aug 14 8pm',
  'Tyler the Creator MSG Sep 22 sec 224',
];

export default function AddChatScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showToast } = useFeedback();

  const [text, setText] = React.useState('');
  const parse = trpc.enrichment.parseChat.useMutation();

  const submit = React.useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;
      try {
        const parsed = await parse.mutateAsync({ freeText: trimmed });
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
        const message = err instanceof Error ? err.message : 'Couldn’t parse';
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
    fontFamily: 'Georgia',
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
});
