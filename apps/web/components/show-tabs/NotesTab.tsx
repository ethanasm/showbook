"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SectionFrame } from "./SectionFrame";
import "./show-tabs.css";

interface NotesTabProps {
  isPast: boolean;
  notes: string;
  onSave: (next: string) => Promise<void> | void;
}

const PROMPTS_PRE = [
  "Songs I want to hear",
  "Who I'm going with",
  "Pre-show plan",
  "What this show means to me",
];
const PROMPTS_POST = [
  "My favorite moment",
  "Who I went with · vibe",
  "A song I'll never forget",
  "Would I see them again?",
];

/**
 * Notes tab — a single textarea bound to `shows.notes` plus quick
 * prompts beneath. Phase 1 wires the textarea to `shows.update`
 * via the parent show-detail page; the save handler is passed in.
 */
export function NotesTab({ isPast, notes, onSave }: NotesTabProps) {
  const [draft, setDraft] = useState<string>(notes);
  const [saving, setSaving] = useState<boolean>(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prompts = isPast ? PROMPTS_POST : PROMPTS_PRE;

  useEffect(() => {
    setDraft(notes);
  }, [notes]);

  const scheduleSave = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        if (value === notes) return;
        setSaving(true);
        try {
          await onSave(value);
          setLastSavedAt(new Date());
        } finally {
          setSaving(false);
        }
      }, 600);
    },
    [notes, onSave],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setDraft(value);
      scheduleSave(value);
    },
    [scheduleSave],
  );

  const appendPrompt = useCallback(
    (prompt: string) => {
      const next = draft.length === 0 ? `${prompt}: ` : `${draft.trimEnd()}\n\n${prompt}: `;
      setDraft(next);
      scheduleSave(next);
    },
    [draft, scheduleSave],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return (
    <div data-testid="show-tab-notes">
      <SectionFrame title="Your notes">
        <textarea
          aria-label="Show notes"
          data-testid="show-notes-textarea"
          value={draft}
          onChange={handleChange}
          placeholder={
            isPast
              ? "Capture a memory before it fades — what blew you away, the people, the bar, the walk home."
              : "Capture a thought before the show — what you're hoping to hear, who you're going with, the bar plan."
          }
          style={{
            width: "100%",
            minHeight: 200,
            padding: "16px 18px",
            background: "var(--surface)",
            border: "1px solid var(--rule)",
            borderLeft: "2px solid var(--faint)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--ink)",
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10,
            color: "var(--faint)",
            marginTop: 10,
            letterSpacing: ".04em",
          }}
        >
          {saving
            ? "saving…"
            : lastSavedAt
              ? `saved ${lastSavedAt.toLocaleTimeString()}`
              : "only you see this · auto-saves as you type"}
        </div>
      </SectionFrame>
      <SectionFrame title="Quick prompts">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 8,
          }}
        >
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => appendPrompt(prompt)}
              data-testid={`notes-prompt-${prompt.toLowerCase().replace(/\s+/g, "-")}`}
              style={{
                padding: "12px 14px",
                background: "transparent",
                border: "1px solid var(--rule)",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                color: "var(--ink)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              + {prompt}
            </button>
          ))}
        </div>
      </SectionFrame>
    </div>
  );
}
