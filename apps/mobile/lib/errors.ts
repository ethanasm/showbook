/**
 * User-facing error message extraction.
 *
 * tRPC + Drizzle let raw SQL leak into `err.message` when the server
 * doesn't catch / rewrap a DB error — the format is
 * `Failed query: insert into "..." values ($1, ...) params: ...`. That's
 * useless to a user and, in a toast, long enough to dominate the screen.
 * `toUserMessage` recognises those internal shapes and falls back to the
 * caller-supplied fallback, while passing user-readable errors through
 * (capped at a sensible length so a runaway message can't cover the UI).
 */

const MAX_TOAST_CHARS = 160;

const INTERNAL_PREFIXES = [
  'failed query:',
  'duplicate key value',
  'insert or update on table',
  'violates foreign key constraint',
  'invalid input syntax',
  'syntaxerror',
  'unique constraint',
  // Zod schema-validation blobs leak from LLM-backed procedures when
  // the model returns a shape the server doesn't accept. The error
  // message is a multi-line JSON dump (path, code, expected/received)
  // that's actively misleading to a user.
  'failed schema validation',
  'groq response failed schema validation',
  'no response from groq',
  'failed to parse groq response',
];

export function isInternalErrorMessage(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return INTERNAL_PREFIXES.some((p) => lower.startsWith(p));
}

export function toUserMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : '';
  if (!raw) return fallback;
  if (isInternalErrorMessage(raw)) return fallback;
  if (raw.length > MAX_TOAST_CHARS) return raw.slice(0, MAX_TOAST_CHARS - 1) + '…';
  return raw;
}
