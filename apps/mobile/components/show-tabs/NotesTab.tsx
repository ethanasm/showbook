/**
 * NotesTab (mobile) — single multiline TextInput bound to `shows.notes`
 * with quick-prompt buttons that append a labeled prompt at the cursor.
 * Auto-saves on a debounce so the user never has to hit a Save button.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '../../lib/theme';
import { SectionFrame } from './SectionFrame';

const PROMPTS_PRE = [
  'Songs I want to hear',
  "Who I'm going with",
  'Pre-show plan',
  'What this show means to me',
];
const PROMPTS_POST = [
  'My favorite moment',
  'Who I went with · vibe',
  "A song I'll never forget",
  'Would I see them again?',
];

export interface NotesTabProps {
  isPast: boolean;
  notes: string;
  onSave: (next: string) => Promise<void> | void;
}

export function NotesTab({
  isPast,
  notes,
  onSave,
}: NotesTabProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const [draft, setDraft] = React.useState(notes);
  const [saving, setSaving] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const prompts = isPast ? PROMPTS_POST : PROMPTS_PRE;

  React.useEffect(() => {
    setDraft(notes);
  }, [notes]);

  const schedule = React.useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void (async () => {
          if (value === notes) return;
          setSaving(true);
          try {
            await onSave(value);
            setLastSavedAt(new Date());
          } finally {
            setSaving(false);
          }
        })();
      }, 600);
    },
    [notes, onSave],
  );

  const handleChange = React.useCallback(
    (value: string) => {
      setDraft(value);
      schedule(value);
    },
    [schedule],
  );

  const appendPrompt = React.useCallback(
    (prompt: string) => {
      const next =
        draft.length === 0
          ? `${prompt}: `
          : `${draft.trimEnd()}\n\n${prompt}: `;
      setDraft(next);
      schedule(next);
    },
    [draft, schedule],
  );

  React.useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return (
    <View testID="show-tab-notes">
      <SectionFrame title="Your notes">
        <TextInput
          multiline
          value={draft}
          onChangeText={handleChange}
          placeholder={
            isPast
              ? 'Capture a memory before it fades — what blew you away, the people, the walk home.'
              : "Capture a thought before the show — what you're hoping to hear, who you're going with."
          }
          placeholderTextColor={colors.faint}
          accessibilityLabel="Show notes"
          testID="show-notes-textarea"
          style={[
            styles.input,
            {
              color: colors.ink,
              backgroundColor: colors.surface,
              borderColor: colors.rule,
              borderLeftColor: colors.ruleStrong,
            },
          ]}
        />
        <Text style={[styles.savedLine, { color: colors.faint }]}>
          {saving
            ? 'saving…'
            : lastSavedAt
              ? `saved ${lastSavedAt.toLocaleTimeString()}`
              : 'only you see this · auto-saves as you type'}
        </Text>
      </SectionFrame>
      <SectionFrame title="Quick prompts">
        <View style={styles.promptCol}>
          {prompts.map((prompt) => (
            <Pressable
              key={prompt}
              onPress={() => appendPrompt(prompt)}
              accessibilityRole="button"
              accessibilityLabel={prompt}
              style={({ pressed }) => [
                styles.promptButton,
                {
                  borderColor: colors.rule,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={[styles.promptLabel, { color: colors.ink }]}>
                + {prompt}
              </Text>
            </Pressable>
          ))}
        </View>
      </SectionFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 180,
    padding: 16,
    fontFamily: 'Geist Sans',
    fontSize: 14,
    lineHeight: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 2,
    textAlignVertical: 'top',
  },
  savedLine: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    letterSpacing: 0.5,
    marginTop: 8,
  },
  promptCol: {
    gap: 8,
  },
  promptButton: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  promptLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
  },
});
