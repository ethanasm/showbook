/**
 * Pure helpers for the chat-mode Add screen's in-session conversation
 * memory. Lives outside the React component so it can be unit-tested
 * inside the mobile coverage gate (`apps/mobile/lib/**`).
 *
 * The buffer is conversation-scoped (kept in `useState` on the chat
 * screen) and capped at the last 5 distinct headliners — anything
 * older has very low signal for pronoun resolution and burns Groq
 * tokens.
 */

export type ConversationKind = 'concert' | 'theatre' | 'comedy' | 'festival';

export interface SessionRecentShow {
  headliner: string;
  date?: string | null;
  venue?: string | null;
  kind?: ConversationKind | null;
}

export const MAX_SESSION_RECENT = 5;

/**
 * Prepend `next` to the recent-shows buffer, removing any prior entry
 * with the same headliner (case-insensitive) so the most recent
 * mention floats to the front. Returns the new array — never mutates.
 * Drops entries with empty / whitespace-only headliners.
 */
export function appendRecent(
  prev: readonly SessionRecentShow[],
  next: SessionRecentShow,
): SessionRecentShow[] {
  const normalized = next.headliner.trim().toLowerCase();
  if (normalized.length === 0) return [...prev];
  const filtered = prev.filter(
    (s) => s.headliner.trim().toLowerCase() !== normalized,
  );
  return [next, ...filtered].slice(0, MAX_SESSION_RECENT);
}

/** Narrow an unknown value to a watchable Kind. */
export function isConversationKind(value: unknown): value is ConversationKind {
  return (
    value === 'concert' ||
    value === 'theatre' ||
    value === 'comedy' ||
    value === 'festival'
  );
}
