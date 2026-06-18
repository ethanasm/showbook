import Groq from 'groq-sdk';
import { z } from 'zod';
import { traceLLM, groqUsage, child } from '@showbook/observability';
import {
  LlmCallError,
  LlmEmptyResponseError,
  LlmParseError,
  LlmValidationError,
  withLlmRetry,
} from './llm-call';
import {
  EXTRACT_CAST_PROMPT,
  EXTRACT_SHOW_FROM_EMAIL_PROMPT,
  EXTRACT_SHOW_FROM_PDF_PROMPT,
  FESTIVAL_LINEUP_INSTRUCTIONS,
  PARSE_SHOW_INPUT_BASE_PROMPT,
  PARSE_SHOW_INPUT_CONTEXT_PREFIX,
  PARSE_SHOW_INPUT_CONTEXT_SUFFIX,
} from './llm-prompts';

// ---------------------------------------------------------------------------
// Runtime-validation schemas for LLM JSON output. We never trust Groq output
// shape blindly — a jailbroken or model-changed response could deliver
// unexpected fields that would otherwise flow into the DB.
// ---------------------------------------------------------------------------

const kindHintSchema = z
  .enum(['concert', 'theatre', 'comedy', 'festival'])
  .nullable();

const parsedShowInputSchema = z.object({
  // Nullable: ambiguous inputs ("I also saw him October 23, 2016") can
  // refer to a previously-discussed performer that this stateless
  // procedure has no visibility into. Returning null lets the chat
  // open the form with whatever fields *did* resolve, instead of the
  // mutation throwing a schema-validation error the user can't act
  // on.
  headliner: z.string().nullable(),
  venue_hint: z.string().nullable(),
  date_hint: z.string().nullable(),
  seat_hint: z.string().nullable(),
  kind_hint: kindHintSchema,
});

const extractedTicketInfoSchema = z.object({
  headliner: z.string(),
  production_name: z.string().nullable(),
  venue_name: z.string().nullable(),
  venue_city: z.string().nullable(),
  venue_state: z.string().nullable(),
  date: z.string().nullable(),
  seat: z.string().nullable(),
  price: z.string().nullable(),
  ticket_count: z.number().nullable(),
  kind_hint: kindHintSchema,
  confidence: z.enum(['high', 'medium', 'low']),
});

const castMemberSchema = z.object({
  actor: z.string().min(1).max(200),
  role: z.string().min(1).max(200),
});
const castResponseSchema = z.object({
  cast: z.array(castMemberSchema).default([]),
});

const lineupArtistSchema = z.object({
  name: z.string().min(1).max(120),
  tier: z.enum(['headliner', 'support']).default('support'),
});
const festivalLineupSchema = z.object({
  festival_name: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  venue_hint: z.string().nullable(),
  artists: z.array(lineupArtistSchema).max(200).default([]),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedShowInput {
  headliner: string | null;
  venue_hint: string | null;
  date_hint: string | null;
  seat_hint: string | null;
  kind_hint: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
}

export interface CastMember {
  actor: string;
  role: string;
}

export interface FestivalLineupArtist {
  name: string;
  tier: 'headliner' | 'support';
}

export interface FestivalLineup {
  festivalName: string | null;
  startDate: string | null;
  endDate: string | null;
  venueHint: string | null;
  artists: FestivalLineupArtist[];
}

export interface ExtractedTicketInfo {
  headliner: string;
  production_name: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  date: string | null;
  seat: string | null;
  price: string | null;
  ticket_count: number | null;
  kind_hint: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
  confidence: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const log = child({ component: 'groq.vision' });

let _groq: Groq | null = null;
function groq(): Groq {
  if (_groq) return _groq;
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set — cannot use Groq features.');
  }
  _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

export const __test = {
  setClient(client: unknown): void {
    _groq = client as Groq | null;
  },
  detectImageMime,
};

/**
 * Lightweight liveness check for the Groq API. Lists models — no token
 * burn, no LLM trace. Used by the health-check cron to verify the API
 * key is valid and the service is reachable.
 */
export async function pingGroq(): Promise<{ models: number }> {
  const list = await groq().models.list();
  return { models: list.data.length };
}

// Text model: openai/gpt-oss-120b on Groq. Cheaper ($0.15/$0.60 vs $0.59/$0.79
// per Mtok input/output) and produces noticeably more specific outputs on the
// digest/health summary prompts than llama-3.3-70b-versatile. We pin
// `reasoning_effort: 'low'` because the default ('medium') burns 4–10× more
// completion tokens for our JSON-shaped prompts without quality gains.
const MODEL_TEXT = 'openai/gpt-oss-120b';
const TEXT_REASONING_EFFORT = 'low' as const;
// Vision model: Qwen3.6 27B on Groq — used by the two image paths (playbill
// cast extraction + festival-poster lineup). Migrated off Llama 4 Scout
// (`meta-llama/llama-4-scout-17b-16e-instruct`), which Groq deprecated 2026-06-17
// and decommissions 2026-07-17. The first migration target, Llama 4 Maverick,
// was already removed from Groq's catalog — every vision call 404'd and, because
// both image callers swallow Groq errors into an empty result, the breakage
// surfaced only as a user report ("no artists found"), not an exception. Groq's
// emailed text replacements (gpt-oss-120b / "Qwen3 32B" = `qwen/qwen3-32b`) are
// text-only; `qwen/qwen3.6-27b` is the distinct vision-capable Qwen and is the
// durable multimodal model still supported. It accepts the same OpenAI-style
// image_url data-URL message shape and `response_format: json_object` (verified
// against real posters + a playbill before this migration landed).
const MODEL_VISION = 'qwen/qwen3.6-27b';


function pickContent(result: { choices: Array<{ message: { content: string | null } }> }): string | null {
  return result.choices[0]?.message?.content ?? null;
}

// ---------------------------------------------------------------------------
// parseShowInput — free-text → structured show fields
// ---------------------------------------------------------------------------

/**
 * In-session conversation context the chat surface can hand to
 * `parseShowInput` so multi-turn references resolve. Without context,
 * a follow-up like "I also saw him October 23, 2016" leaves Groq
 * with no antecedent for "him" — with `recentShows: [{ headliner:
 * 'Bon Iver' }]` it resolves to Bon Iver and the form opens
 * pre-filled.
 *
 * The list is conversation-scoped (cleared when the chat screen
 * unmounts) so a session never bleeds into another user / device /
 * cold-launch.
 */
export interface ParseShowInputContext {
  recentShows?: Array<{
    headliner: string;
    date?: string | null;
    venue?: string | null;
    kind?: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
  }>;
}

/**
 * Format the recent-shows context as a short bullet list the model
 * can scan. Exported for unit testing — the user-visible behavior
 * depends on the exact wording.
 */
export function formatRecentShowsContext(
  context: ParseShowInputContext | undefined,
): string | null {
  const recent = context?.recentShows ?? [];
  if (recent.length === 0) return null;
  const lines = recent
    .slice(0, 5)
    .map((s) => {
      const bits = [s.headliner];
      if (s.venue) bits.push(`at ${s.venue}`);
      if (s.date) bits.push(`on ${s.date}`);
      if (s.kind) bits.push(`(${s.kind})`);
      return `- ${bits.join(' ')}`;
    })
    .join('\n');
  return lines;
}

export async function parseShowInput(
  freeText: string,
  context?: ParseShowInputContext,
): Promise<ParsedShowInput> {
  const contextBlock = formatRecentShowsContext(context);
  const systemContent =
    PARSE_SHOW_INPUT_BASE_PROMPT +
    (contextBlock
      ? PARSE_SHOW_INPUT_CONTEXT_PREFIX +
        contextBlock +
        PARSE_SHOW_INPUT_CONTEXT_SUFFIX
      : '');

  const messages = [
    { role: 'system' as const, content: systemContent },
    { role: 'user' as const, content: freeText },
  ];

  // Failure-mode contract: the helper throws `LlmCallError` /
  // `LlmEmptyResponseError` / `LlmParseError` / `LlmValidationError`
  // depending on where the call fell over. They all extend `Error`
  // with the same human-readable message the previous inline
  // implementation produced, so callers that catch by message regex
  // keep working.
  return withLlmRetry({
    name: 'groq.parseShowInput',
    model: MODEL_TEXT,
    tracedInput: messages,
    modelParameters: { response_format: 'json_object', reasoning_effort: TEXT_REASONING_EFFORT },
    run: () =>
      groq().chat.completions.create({
        model: MODEL_TEXT,
        messages,
        response_format: { type: 'json_object' },
        reasoning_effort: TEXT_REASONING_EFFORT,
      }),
    schema: parsedShowInputSchema,
  });
}

// ---------------------------------------------------------------------------
// extractShowFromEmail — ticket confirmation email → structured show data
// ---------------------------------------------------------------------------

export async function extractShowFromEmail(
  emailSubject: string,
  emailBody: string,
  emailFrom: string,
  emailDate?: string,
  retries = 3,
): Promise<ExtractedTicketInfo | null> {
  const messages = [
    { role: 'system' as const, content: EXTRACT_SHOW_FROM_EMAIL_PROMPT },
    {
      role: 'user' as const,
      content: `Subject: ${emailSubject}\nFrom: ${emailFrom}\nDate: ${emailDate ?? 'unknown'}\n\n${emailBody.slice(0, 8000)}`,
    },
  ];

  // Email extraction has the loosest contract of the six callers: any
  // failure (429 retries exhausted, no content, bad JSON, schema miss,
  // low-confidence verdict) collapses to `null` so the Gmail scan loop
  // skips the message and moves on.
  let data: ExtractedTicketInfo;
  try {
    data = await withLlmRetry({
      name: 'groq.extractShowFromEmail',
      model: MODEL_TEXT,
      tracedInput: messages,
      modelParameters: { response_format: 'json_object', reasoning_effort: TEXT_REASONING_EFFORT },
      run: () =>
        groq().chat.completions.create({
          model: MODEL_TEXT,
          messages,
          response_format: { type: 'json_object' },
          reasoning_effort: TEXT_REASONING_EFFORT,
        }),
      schema: extractedTicketInfoSchema,
      retries,
    });
  } catch {
    return null;
  }
  if (!data.headliner || data.confidence === 'low') return null;
  return data;
}

// ---------------------------------------------------------------------------
// validateAndDedupTickets — LLM pass to clean up extracted results
// ---------------------------------------------------------------------------

export async function validateAndDedupTickets<T extends ExtractedTicketInfo>(
  tickets: T[],
): Promise<T[]> {
  if (tickets.length === 0) return [];

  const messages = [
    {
      role: 'system' as const,
      content:
        'You are a data cleanup assistant for a live entertainment tracker.\n\n' +
        'Given a JSON array of extracted ticket records, return a cleaned array that:\n' +
        '1. MERGES duplicates — same artist + same date, or same artist + same venue = combine into one entry. Take the most complete data from each (e.g. one has the price, another has the seat — merge both into one record)\n' +
        '2. NORMALIZES headliner names (consistent casing, remove "presents" suffixes, etc.)\n' +
        '3. VALIDATES dates are in YYYY-MM-DD format\n\n' +
        'DO NOT remove entries. Only merge duplicates and clean up data. Keep everything else as-is.\n\n' +
        'Return ONLY a JSON object with a "tickets" key containing the cleaned array. Preserve all original fields.',
    },
    { role: 'user' as const, content: JSON.stringify(tickets) },
  ];

  const result = await traceLLM({
    name: 'groq.validateAndDedupTickets',
    model: MODEL_TEXT,
    input: messages,
    modelParameters: { response_format: 'json_object', reasoning_effort: TEXT_REASONING_EFFORT },
    metadata: { ticketCount: tickets.length },
    run: () =>
      groq().chat.completions.create({
        model: MODEL_TEXT,
        messages,
        response_format: { type: 'json_object' },
        reasoning_effort: TEXT_REASONING_EFFORT,
      }),
    extractUsage: groqUsage,
    extractOutput: pickContent,
  });

  const content = pickContent(result);
  if (!content) return tickets;

  try {
    const parsed = JSON.parse(content) as { tickets: T[] };
    return parsed.tickets ?? tickets;
  } catch {
    return tickets;
  }
}

// ---------------------------------------------------------------------------
// extractShowFromPdfText — PDF text → structured show data
// ---------------------------------------------------------------------------

export async function extractShowFromPdfText(
  pdfText: string,
): Promise<ExtractedTicketInfo> {
  const messages = [
    { role: 'system' as const, content: EXTRACT_SHOW_FROM_PDF_PROMPT },
    { role: 'user' as const, content: pdfText.slice(0, 8000) },
  ];

  return withLlmRetry({
    name: 'groq.extractShowFromPdfText',
    model: MODEL_TEXT,
    tracedInput: messages,
    modelParameters: { response_format: 'json_object', reasoning_effort: TEXT_REASONING_EFFORT },
    run: () =>
      groq().chat.completions.create({
        model: MODEL_TEXT,
        messages,
        response_format: { type: 'json_object' },
        reasoning_effort: TEXT_REASONING_EFFORT,
      }),
    schema: extractedTicketInfoSchema,
  });
}

function detectImageMime(b64: string): string {
  if (b64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('R0lGOD')) return 'image/gif';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

// ---------------------------------------------------------------------------
// extractCast — playbill image → principal cast list
// ---------------------------------------------------------------------------

export async function extractCast(
  imageBase64: string,
): Promise<CastMember[]> {
  const dataUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:${detectImageMime(imageBase64)};base64,${imageBase64}`;

  const mime = detectImageMime(imageBase64.replace(/^data:[^;]+;base64,/, ''));

  // We never log the raw image bytes to Langfuse — only the prompt + a marker
  // describing the image. The Groq call itself still receives the data URL.
  const tracedInput = [
    {
      role: 'user' as const,
      content: [
        { type: 'image_marker', mime },
        { type: 'text', text: EXTRACT_CAST_PROMPT },
      ],
    },
  ];

  try {
    const data = await withLlmRetry({
      name: 'groq.extractCast',
      model: MODEL_VISION,
      tracedInput,
      modelParameters: { response_format: 'json_object' },
      metadata: { imageMime: mime, imageBytes: imageBase64.length },
      run: () =>
        groq().chat.completions.create({
          model: MODEL_VISION,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: EXTRACT_CAST_PROMPT },
              ],
            },
          ],
          response_format: { type: 'json_object' },
        }),
      schema: castResponseSchema,
    });
    return data.cast;
  } catch (err) {
    // Soft-fail only on schema-validation drift (e.g. a playbill page
    // with no recognizable cast block). Empty response / JSON parse
    // failure still propagates so the caller can show a real error.
    if (err instanceof LlmValidationError) {
      // Log the swallowed failure — returning [] is indistinguishable
      // from "no cast on this page" to the caller, so without this a
      // model regression (the Maverick 404 that prompted this migration)
      // looks like an empty playbill rather than a broken model.
      log.warn(
        { event: 'playbill.cast.extract.llm_failed', model: MODEL_VISION, err },
        'extractCast soft-failed; returning empty cast',
      );
      return [];
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// generateDigestPreamble — short personalized opener for the daily email
// ---------------------------------------------------------------------------

export interface DigestPreambleInput {
  displayName: string;
  todayShows: ReadonlyArray<{ headliner: string; venueName: string; seat: string | null }>;
  upcomingShows: ReadonlyArray<{
    headliner: string;
    venueName: string;
    dateLabel: string;
    daysUntil: number;
  }>;
  newAnnouncements: ReadonlyArray<{
    headliner: string;
    venueName: string;
    whenLabel: string;
    reason: 'venue' | 'artist' | 'region';
    onSaleSoon: boolean;
  }>;
}

const preambleSchema = z.object({
  preamble: z.string().min(1).max(800),
});

/**
 * Returns a 1–2 short paragraph opener for the daily digest, tailored to
 * what the user actually has on deck. Falls back to `null` on any error
 * (missing key, network blip, malformed output) so the digest still ships
 * with the deterministic template content.
 */
export async function generateDigestPreamble(
  input: DigestPreambleInput,
): Promise<string | null> {
  if (!process.env.GROQ_API_KEY) return null;

  const summary = {
    name: input.displayName,
    tonight: input.todayShows.map((s) => ({
      headliner: s.headliner,
      venue: s.venueName,
      seat: s.seat,
    })),
    upcoming: input.upcomingShows.map((s) => ({
      headliner: s.headliner,
      venue: s.venueName,
      when: s.dateLabel,
      daysUntil: s.daysUntil,
    })),
    announcements: input.newAnnouncements.map((a) => ({
      headliner: a.headliner,
      venue: a.venueName,
      when: a.whenLabel,
      reason: a.reason,
      onSaleSoon: a.onSaleSoon,
    })),
  };

  const messages = [
    {
      role: 'system' as const,
      content:
        'You write short, warm openers for a daily live-entertainment email digest. ' +
        'Voice: direct, specific, lightly literary, never breathless or salesy. ' +
        'Address the reader by first name once if natural. Reference concrete details ' +
        '(artists, venues, days-until, on-sale) — never invent facts not in the input. ' +
        'Length: one paragraph if there is little to report, up to two short paragraphs ' +
        'when the day is busy. Hard cap of 80 words total. No emoji, no markdown, no ' +
        'headings, no bullet points. Plain prose only — paragraphs separated by a single ' +
        'blank line. Do not list every item; pick the most interesting beat. If there is ' +
        'nothing on deck, write a single sentence acknowledging the quiet. ' +
        'Return ONLY a JSON object: {"preamble": "..."}.',
    },
    {
      role: 'user' as const,
      content: JSON.stringify(summary),
    },
  ];

  try {
    const result = await traceLLM({
      name: 'groq.generateDigestPreamble',
      model: MODEL_TEXT,
      input: messages,
      modelParameters: { response_format: 'json_object', temperature: 0.7, reasoning_effort: TEXT_REASONING_EFFORT },
      run: () =>
        groq().chat.completions.create({
          model: MODEL_TEXT,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.7,
          reasoning_effort: TEXT_REASONING_EFFORT,
        }),
      extractUsage: groqUsage,
      extractOutput: pickContent,
    });

    const content = pickContent(result);
    if (!content) return null;
    const raw = JSON.parse(content) as unknown;
    const parsed = preambleSchema.safeParse(raw);
    if (!parsed.success) return null;
    const text = parsed.data.preamble.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// generateHealthSummaryPreamble — short ops-grade opener for the morning
// health-check email. Different voice from the user-facing digest: terse,
// factual, prioritizes what's broken.
// ---------------------------------------------------------------------------

export interface HealthSummaryPreambleInput {
  status: 'ok' | 'warn' | 'fail' | 'unknown';
  checks: ReadonlyArray<{
    name: string;
    status: 'ok' | 'warn' | 'fail' | 'unknown';
    summary: string;
    detail?: Record<string, unknown>;
  }>;
}

/**
 * Returns a 1–2 short paragraph operator-facing summary for the morning
 * health-check email. Voice is dense and specific — assumes the reader
 * is the on-call operator who needs to triage in 10 seconds. Falls back
 * to `null` on any error (missing key, network blip, malformed output)
 * so the email still ships with the deterministic check rows.
 */
export async function generateHealthSummaryPreamble(
  input: HealthSummaryPreambleInput,
): Promise<string | null> {
  if (!process.env.GROQ_API_KEY) return null;

  // Trim detail payloads so the prompt stays small. We keep the shape
  // but stringify-cap each detail so a 50-row failures array doesn't
  // blow up the input window.
  const condensed = {
    status: input.status,
    checks: input.checks.map((c) => ({
      name: c.name,
      status: c.status,
      summary: c.summary,
      detail: c.detail ? truncateDetail(c.detail) : undefined,
    })),
  };

  const messages = [
    {
      role: 'system' as const,
      content:
        'You write the opener for a daily morning ops health-check email for the Showbook stack ' +
        '(Next.js + Postgres + pg-boss). The reader is the on-call operator. Voice: terse, factual, ' +
        'prioritized by severity (fail > warn > unknown > ok). Lead with what is broken or missing ' +
        'and what to look at; if everything is healthy, say so in one sentence and stop. ' +
        'Reference concrete check names and details from the input — never invent facts. ' +
        'Length: one paragraph; up to two short paragraphs when there are multiple failures. ' +
        'Hard cap 90 words. Plain prose only — no markdown, no headings, no bullets, no emoji. ' +
        'Paragraphs separated by a single blank line. Do not enumerate every check; the ' +
        'detailed list is below the preamble already. ' +
        'Return ONLY a JSON object: {"preamble": "..."}.',
    },
    {
      role: 'user' as const,
      content: JSON.stringify(condensed),
    },
  ];

  try {
    const result = await traceLLM({
      name: 'groq.generateHealthSummaryPreamble',
      model: MODEL_TEXT,
      input: messages,
      modelParameters: { response_format: 'json_object', temperature: 0.4, reasoning_effort: TEXT_REASONING_EFFORT },
      run: () =>
        groq().chat.completions.create({
          model: MODEL_TEXT,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.4,
          reasoning_effort: TEXT_REASONING_EFFORT,
        }),
      extractUsage: groqUsage,
      extractOutput: pickContent,
    });

    const content = pickContent(result);
    if (!content) return null;
    const raw = JSON.parse(content) as unknown;
    const parsed = preambleSchema.safeParse(raw);
    if (!parsed.success) return null;
    const text = parsed.data.preamble.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// summarizeShowSaved — chat-style confirmation after adding a show
// ---------------------------------------------------------------------------

export interface ShowSavedSummaryInput {
  kind: 'concert' | 'theatre' | 'comedy' | 'festival';
  title: string;
  venueName: string;
  venueCity?: string | null;
  /** YYYY-MM-DD calendar date, or null when not yet pinned down. */
  date: string | null;
  /** Optional festival end date YYYY-MM-DD. */
  endDate?: string | null;
  /** Was this show created in the past, ticketed-future, or watching state? */
  state: 'past' | 'ticketed' | 'watching';
  /** Lineup / support names, in sortOrder. Used to colour the message. */
  supportingActs: string[];
}

const showSavedSchema = z.object({
  message: z.string().min(1).max(280),
});

/**
 * Render a short chat-style confirmation that the show was saved.
 * The chat screen displays this above the composer so the user can
 * keep going — "Got it, X is in the books. Anything else?" register.
 *
 * Returns null on any failure (missing key, malformed output) so the
 * caller can fall back to a deterministic template.
 */
export async function summarizeShowSaved(
  input: ShowSavedSummaryInput,
): Promise<string | null> {
  if (!process.env.GROQ_API_KEY) return null;

  const messages = [
    {
      role: 'system' as const,
      content:
        'You write a one-sentence chat-style confirmation that a show was added to the user\'s personal entertainment tracker. ' +
        'Voice: warm, factual, low-key — like a friend acknowledging "got it". ' +
        'Reference the headliner / production name and the venue. Optionally reference the date in a casual way ' +
        '("next Friday", "in August", "back in 2018") only if it adds clarity; never just echo "YYYY-MM-DD". ' +
        'End with a brief invitation to add another or do something else (e.g. "Anything else?" / "What else?"). ' +
        'Hard cap 35 words. Plain prose, no markdown, no emoji, no exclamation marks. ' +
        'Return ONLY a JSON object: {"message": "..."}.',
    },
    {
      role: 'user' as const,
      content: JSON.stringify(input),
    },
  ];

  try {
    const result = await traceLLM({
      name: 'groq.summarizeShowSaved',
      model: MODEL_TEXT,
      input: messages,
      modelParameters: { response_format: 'json_object', temperature: 0.6, reasoning_effort: TEXT_REASONING_EFFORT },
      run: () =>
        groq().chat.completions.create({
          model: MODEL_TEXT,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.6,
          reasoning_effort: TEXT_REASONING_EFFORT,
        }),
      extractUsage: groqUsage,
      extractOutput: pickContent,
    });

    const content = pickContent(result);
    if (!content) return null;
    const raw = JSON.parse(content) as unknown;
    const parsed = showSavedSchema.safeParse(raw);
    if (!parsed.success) return null;
    const text = parsed.data.message.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function truncateDetail(detail: Record<string, unknown>): Record<string, unknown> {
  // Cap each top-level value's serialized form so a 50-row failures
  // array doesn't dominate the prompt. We keep the shape, just shrink.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (Array.isArray(v)) {
      out[k] = v.slice(0, 5);
    } else {
      const s = JSON.stringify(v);
      out[k] = s && s.length > 200 ? s.slice(0, 197) + '…' : v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// extractFestivalLineup — festival poster / schedule → lineup with tiers
// ---------------------------------------------------------------------------

const EMPTY_FESTIVAL_LINEUP: FestivalLineup = {
  festivalName: null,
  startDate: null,
  endDate: null,
  venueHint: null,
  artists: [],
};

/** Map the schema's snake_case shape to the camelCase domain type. */
function toFestivalLineup(
  parsed: z.infer<typeof festivalLineupSchema>,
): FestivalLineup {
  return {
    festivalName: parsed.festival_name,
    startDate: parsed.start_date,
    endDate: parsed.end_date,
    venueHint: parsed.venue_hint,
    artists: parsed.artists,
  };
}

/**
 * Festival lineup extraction is the most permissive of the six
 * callers: any failure (empty content, malformed JSON, schema miss,
 * Groq error) collapses to an empty lineup so the operator can still
 * pick artists by hand.
 */
function safeExtractFestivalLineup(
  source: 'image' | 'pdf',
  model: string,
  run: () => Promise<z.infer<typeof festivalLineupSchema>>,
): Promise<FestivalLineup> {
  return run().then(toFestivalLineup).catch((err) => {
    if (
      err instanceof LlmCallError ||
      err instanceof LlmEmptyResponseError ||
      err instanceof LlmParseError ||
      err instanceof LlmValidationError
    ) {
      // Log the swallowed failure before collapsing to an empty lineup.
      // The empty result is indistinguishable from "poster had no
      // artists" to the caller, so a model regression (the Maverick 404
      // that prompted this migration) surfaced only as a user report.
      // A warn here makes the next dead-model case greppable in Axiom.
      log.warn(
        { event: 'festival.lineup.extract.llm_failed', source, model, err },
        'festival lineup extraction soft-failed; returning empty lineup',
      );
      return EMPTY_FESTIVAL_LINEUP;
    }
    throw err;
  });
}

export async function extractFestivalLineupFromImage(
  imageBase64: string,
): Promise<FestivalLineup> {
  const dataUrl = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:${detectImageMime(imageBase64)};base64,${imageBase64}`;
  const mime = detectImageMime(imageBase64.replace(/^data:[^;]+;base64,/, ''));

  const tracedInput = [
    {
      role: 'user' as const,
      content: [
        { type: 'image_marker', mime },
        { type: 'text', text: FESTIVAL_LINEUP_INSTRUCTIONS },
      ],
    },
  ];

  return safeExtractFestivalLineup('image', MODEL_VISION, () =>
    withLlmRetry({
      name: 'groq.extractFestivalLineup',
      model: MODEL_VISION,
      tracedInput,
      modelParameters: { response_format: 'json_object' },
      metadata: { source: 'image', imageMime: mime, imageBytes: imageBase64.length },
      run: () =>
        groq().chat.completions.create({
          model: MODEL_VISION,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: FESTIVAL_LINEUP_INSTRUCTIONS },
              ],
            },
          ],
          response_format: { type: 'json_object' },
        }),
      schema: festivalLineupSchema,
    }),
  );
}

export async function extractFestivalLineupFromPdfText(
  pdfText: string,
): Promise<FestivalLineup> {
  const messages = [
    { role: 'system' as const, content: FESTIVAL_LINEUP_INSTRUCTIONS },
    { role: 'user' as const, content: pdfText.slice(0, 12000) },
  ];

  return safeExtractFestivalLineup('pdf', MODEL_TEXT, () =>
    withLlmRetry({
      name: 'groq.extractFestivalLineup',
      model: MODEL_TEXT,
      tracedInput: messages,
      modelParameters: {
        response_format: 'json_object',
        reasoning_effort: TEXT_REASONING_EFFORT,
      },
      metadata: { source: 'pdf', textBytes: pdfText.length },
      run: () =>
        groq().chat.completions.create({
          model: MODEL_TEXT,
          messages,
          response_format: { type: 'json_object' },
          reasoning_effort: TEXT_REASONING_EFFORT,
        }),
      schema: festivalLineupSchema,
    }),
  );
}
