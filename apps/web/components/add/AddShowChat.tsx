"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { mono, sans } from "@/app/(app)/add/constants";
import type { ChatParsedResult } from "@/app/(app)/add/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type ParseChatMutation = ReturnType<typeof trpc.enrichment.parseChat.useMutation>;
type CreateShowMutation = ReturnType<typeof trpc.shows.create.useMutation>;

interface AddShowChatProps {
  parseChat: ParseChatMutation;
  createShow: CreateShowMutation;
  festivalFlowPhase: string;
  onFestivalFile: (file: File) => Promise<void> | void;
}

/**
 * Conversational mode of the Add page. Self-contained: owns its own
 * message history and the Groq-parsed-show preview, calls the
 * `enrichment.parseChat` mutation to extract structured fields from
 * free text, and dispatches `shows.create` straight from the parsed
 * preview when the user confirms. A 📎 attach button delegates a
 * festival-poster file back to the parent so the festival-lineup
 * extraction picker is shared with Form mode.
 */
export function AddShowChat({
  parseChat,
  createShow,
  festivalFlowPhase,
  onFestivalFile,
}: AddShowChatProps) {
  const router = useRouter();
  const chatFestivalFileInputRef = useRef<HTMLInputElement>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        'Tell me about a show you saw or are going to see. For example: "Saw Radiohead at MSG on March 15, section 204"',
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatParsed, setChatParsed] = useState<ChatParsedResult | null>(null);
  const [chatConfirmed, setChatConfirmed] = useState(false);

  const handleChatSend = useCallback(async () => {
    if (!chatInput.trim()) return;

    const userMessage = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setChatInput("");

    try {
      const result = await parseChat.mutateAsync({ freeText: userMessage });
      setChatParsed(result);

      const parts: string[] = [];
      if (result.headliner) parts.push(`Headliner: ${result.headliner}`);
      if (result.venue_hint) parts.push(`Venue: ${result.venue_hint}`);
      if (result.date_hint) parts.push(`Date: ${result.date_hint}`);
      if (result.seat_hint) parts.push(`Seat: ${result.seat_hint}`);
      if (result.kind_hint) parts.push(`Type: ${result.kind_hint}`);

      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Here's what I got:\n\n${parts.join("\n")}\n\nLook right? Click "Confirm & Save" to add this show, or tell me what to change.`,
        },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry, I had trouble understanding that. Could you try again with more details?",
        },
      ]);
    }
  }, [chatInput, parseChat]);

  const handleChatConfirmSave = useCallback(async () => {
    if (!chatParsed) return;
    if (!chatParsed.headliner) {
      // parseChat can resolve a date / kind without a name (e.g.
      // "I saw something October 23, 2016"). Surface that gap as an
      // assistant message and reset the confirm state instead of
      // sending an empty `headliner.name` to a Zod-required field.
      setChatConfirmed(false);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Who was the headliner? Reply with the artist / production name and I'll fill in the rest.",
        },
      ]);
      return;
    }
    const headlinerName = chatParsed.headliner;

    const showKind = chatParsed.kind_hint ?? "concert";
    const showDate =
      chatParsed.date_hint ?? new Date().toISOString().split("T")[0]!;

    try {
      const created = await createShow.mutateAsync({
        kind: showKind,
        headliner: { name: headlinerName },
        venue: {
          name: chatParsed.venue_hint ?? "Unknown Venue",
          city: "Unknown",
        },
        date: showDate,
        seat: chatParsed.seat_hint ?? undefined,
      });
      router.push(created ? `/shows/${created.id}` : "/home");
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "There was an error saving the show. Please try again.",
        },
      ]);
    }
  }, [chatParsed, createShow, router]);

  const handleChatFestivalFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setChatMessages((prev) => [
        ...prev,
        { role: "user", content: `📎 ${file.name}` },
        { role: "assistant", content: "Reading poster — pick artists you saw…" },
      ]);
      await onFestivalFile(file);
    },
    [onFestivalFile],
  );

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 16,
      minHeight: 400,
    }}>
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        marginBottom: 16,
      }}>
        {chatMessages.map((msg, i) => (
          <div
            key={i}
            style={{
              maxWidth: "80%",
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              padding: "12px 16px",
              borderRadius: 12,
              background: msg.role === "user" ? "var(--accent)" : "var(--surface)",
              color: msg.role === "user" ? "var(--accent-text)" : "var(--ink)",
              fontFamily: sans,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {msg.content.split("\n").map((line, j) => (
              <div key={j}>{line || " "}</div>
            ))}
          </div>
        ))}
        {parseChat.isPending && (
          <div style={{
            alignSelf: "flex-start",
            padding: "12px 16px",
            borderRadius: 12,
            background: "var(--surface)",
            color: "var(--muted)",
            fontFamily: mono,
            fontSize: 12,
          }}>
            Thinking...
          </div>
        )}
      </div>

      {chatParsed && !chatConfirmed && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            style={{
              padding: "9px 16px",
              background: "var(--ink)",
              color: "var(--bg)",
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
            }}
            onClick={async () => {
              setChatConfirmed(true);
              await handleChatConfirmSave();
            }}
            disabled={createShow.isPending}
          >
            {createShow.isPending ? "Saving..." : "Confirm & Save"}
          </button>
          <button
            type="button"
            style={{
              padding: "9px 14px",
              border: `1px solid var(--rule-strong)`,
              background: "transparent",
              color: "var(--ink)",
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
            onClick={() => {
              setChatParsed(null);
              setChatMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: "No problem! Tell me what to change.",
                },
              ]);
            }}
          >
            Edit
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          ref={chatFestivalFileInputRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={handleChatFestivalFileChange}
          style={{ display: "none" }}
        />
        <button
          type="button"
          title="Attach a festival poster or schedule"
          aria-label="Attach a festival poster or schedule"
          onClick={() => chatFestivalFileInputRef.current?.click()}
          disabled={festivalFlowPhase === "extracting"}
          style={{
            padding: "9px 12px",
            background: "transparent",
            color: "var(--muted)",
            fontFamily: mono,
            fontSize: 15,
            border: `1px solid var(--rule-strong)`,
            cursor: festivalFlowPhase === "extracting" ? "wait" : "pointer",
            opacity: festivalFlowPhase === "extracting" ? 0.6 : 1,
            lineHeight: 1,
          }}
        >
          📎
        </button>
        <textarea
          style={{
            flex: 1,
            padding: "12px 16px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
            color: "var(--ink)",
            fontFamily: sans,
            fontSize: 13,
            outline: "none",
            resize: "none",
            minHeight: 48,
          }}
          placeholder="Describe your show, or attach a festival poster..."
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleChatSend();
            }
          }}
          rows={1}
        />
        <button
          type="button"
          style={{
            padding: "9px 16px",
            background: "var(--ink)",
            color: "var(--bg)",
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
            opacity: parseChat.isPending || !chatInput.trim() ? 0.4 : 1,
          }}
          onClick={handleChatSend}
          disabled={parseChat.isPending || !chatInput.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
