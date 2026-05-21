/**
 * Gmail scan wire helpers.
 *
 * `/api/gmail/scan` returns SSE (`text/event-stream`). React Native's
 * `fetch` body streaming via `getReader()` works on RN 0.83 but
 * delivery granularity isn't guaranteed — the parser has to tolerate
 * both "one chunk per event" and "everything in a single trailing
 * chunk." Pure-text, no RN/Expo imports so this file is fully
 * unit-testable under node:test.
 */

import type {
  GmailScanDone,
  GmailScanError,
  GmailScanProgress,
} from './types';

export interface ParsedSseEvent {
  event: string;
  data: string;
}

export interface SseParserState {
  buffer: string;
}

export function createSseParserState(): SseParserState {
  return { buffer: '' };
}

/**
 * Feed a text chunk into the parser. Returns any complete events that
 * fell out, leaving partial trailing data in `state.buffer` for the next
 * chunk. Mutates `state.buffer`.
 *
 * Recognises `event:` and `data:` lines, separated by `\n`. Blank lines
 * terminate an event. Matches the spec subset our server emits — we
 * don't need full SSE (no `id:`/`retry:` support).
 */
export function feedSseChunk(state: SseParserState, chunk: string): ParsedSseEvent[] {
  state.buffer += chunk;
  const events: ParsedSseEvent[] = [];

  // Normalise CRLF → LF so we can split on \n alone.
  state.buffer = state.buffer.replace(/\r\n/g, '\n');

  // Events are delimited by a blank line (two consecutive `\n`).
  let idx: number;
  while ((idx = state.buffer.indexOf('\n\n')) !== -1) {
    const raw = state.buffer.slice(0, idx);
    state.buffer = state.buffer.slice(idx + 2);
    const event = parseSseBlock(raw);
    if (event) events.push(event);
  }

  return events;
}

function parseSseBlock(block: string): ParsedSseEvent | null {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (!line) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^\s/, ''));
    }
    // Ignore anything else (comments, id, retry).
  }
  if (dataLines.length === 0) return null;
  return { event: eventName, data: dataLines.join('\n') };
}

export type ScanEvent =
  | { kind: 'progress'; payload: GmailScanProgress }
  | { kind: 'done'; payload: GmailScanDone }
  | { kind: 'error'; payload: GmailScanError };

/**
 * Decode a parsed SSE event into the typed scan event union. Returns
 * `null` if the event name isn't one we care about (forward-compatible
 * with future server additions).
 */
export function decodeScanEvent(parsed: ParsedSseEvent): ScanEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(parsed.data);
  } catch {
    return null;
  }
  if (parsed.event === 'progress') {
    return { kind: 'progress', payload: data as GmailScanProgress };
  }
  if (parsed.event === 'done') {
    return { kind: 'done', payload: data as GmailScanDone };
  }
  if (parsed.event === 'error') {
    return { kind: 'error', payload: data as GmailScanError };
  }
  return null;
}

export interface ScanRunOptions {
  /** Showbook API base URL (e.g. https://showbook.example.com). */
  apiUrl: string;
  /** Gmail OAuth access token from `/api/gmail/callback`. */
  accessToken: string;
  /** Mobile session JWT for `Authorization: Bearer`. */
  sessionToken: string;
  /** Receives every progress update as the server processes batches. */
  onProgress?: (progress: GmailScanProgress) => void;
  /** Optional custom fetch (tests pass a fake). */
  fetchImpl?: typeof fetch;
  /** AbortSignal honoured by the underlying fetch. */
  signal?: AbortSignal;
}

export interface ScanResult {
  tickets: GmailScanDone['tickets'];
  truncated: boolean;
}

/**
 * Drive `/api/gmail/scan` end to end.
 *
 *   - Streams progress events via `onProgress`.
 *   - Resolves with the final `done` payload on success.
 *   - Rejects with the server-provided message on an `error` event, or
 *     with a generic message on transport failure.
 *
 * If the server returns a non-OK status (e.g. 429 rate limit) the
 * promise rejects with the status text so the UI can surface it.
 */
export async function runGmailScan(opts: ScanRunOptions): Promise<ScanResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${opts.apiUrl}/api/gmail/scan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.sessionToken}`,
    },
    body: JSON.stringify({ accessToken: opts.accessToken }),
    signal: opts.signal,
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('Too many Gmail scans — try again in a few minutes.');
    }
    if (res.status === 401) {
      throw new Error('Your session expired. Sign out and back in to retry.');
    }
    throw new Error(`Scan request failed (${res.status})`);
  }
  if (!res.body) {
    // Some platforms (rare) fulfill `fetch` without a streamable body.
    // Fall back to reading the full text and feeding it through the
    // parser in one shot.
    const text = await res.text();
    return consumeFullBody(text, opts.onProgress);
  }
  return consumeStream(res.body, opts.onProgress);
}

/**
 * Translate an `error` SSE payload into a user-facing message. A
 * Gmail-side 401/403 means the access token Google just minted is
 * already unusable (revoked grant, account without Gmail, or a stale
 * cached redirect from a previous attempt) — the right next step is
 * to reconnect rather than retry the same token.
 */
function scanErrorMessage(payload: GmailScanError): string {
  if (payload.status === 401 || payload.status === 403) {
    return 'Gmail rejected the access token. Tap Scan Gmail again to reconnect.';
  }
  if (payload.status && payload.status >= 500) {
    return `Gmail is having trouble (HTTP ${payload.status}). Try again in a minute.`;
  }
  return payload.message || 'Gmail scan failed.';
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: (progress: GmailScanProgress) => void,
): Promise<ScanResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state = createSseParserState();
  let final: ScanResult | null = null;
  let scanError: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const events = feedSseChunk(state, chunk);
    for (const ev of events) {
      const decoded = decodeScanEvent(ev);
      if (!decoded) continue;
      if (decoded.kind === 'progress') onProgress?.(decoded.payload);
      else if (decoded.kind === 'done') final = decoded.payload;
      else if (decoded.kind === 'error') scanError = scanErrorMessage(decoded.payload);
    }
  }

  // Flush any trailing event (server didn't terminate with a blank line).
  const tail = feedSseChunk(state, '\n\n');
  for (const ev of tail) {
    const decoded = decodeScanEvent(ev);
    if (!decoded) continue;
    if (decoded.kind === 'progress') onProgress?.(decoded.payload);
    else if (decoded.kind === 'done') final = decoded.payload;
    else if (decoded.kind === 'error') scanError = scanErrorMessage(decoded.payload);
  }

  if (scanError) throw new Error(scanError);
  if (!final) throw new Error('Gmail scan ended without a result.');
  return final;
}

async function consumeFullBody(
  text: string,
  onProgress?: (progress: GmailScanProgress) => void,
): Promise<ScanResult> {
  const state = createSseParserState();
  const events = feedSseChunk(state, text + '\n\n');
  let final: ScanResult | null = null;
  let scanError: string | null = null;
  for (const ev of events) {
    const decoded = decodeScanEvent(ev);
    if (!decoded) continue;
    if (decoded.kind === 'progress') onProgress?.(decoded.payload);
    else if (decoded.kind === 'done') final = decoded.payload;
    else if (decoded.kind === 'error') scanError = scanErrorMessage(decoded.payload);
  }
  if (scanError) throw new Error(scanError);
  if (!final) throw new Error('Gmail scan ended without a result.');
  return final;
}
