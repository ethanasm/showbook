import Groq from 'groq-sdk';
import { z } from 'zod';
import { traceLLM, groqUsage, child } from '@showbook/observability';

let _groq: Pick<Groq, 'chat'> | null = null;
function groq(): Pick<Groq, 'chat'> {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}
const log = child({ component: 'scrapers.llm' });

export const __test = {
  setClient(client: unknown): void {
    _groq = client as Pick<Groq, 'chat'> | null;
  },
  buildSystemPrompt: (input: LlmExtractInput): string => buildSystemPrompt(input),
  normalizeForQuoteMatch: (s: string): string => normalizeForQuoteMatch(s),
};

const eventSchema = z.object({
  title: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  url: z.string().url().optional(),
  supportActs: z.array(z.string()).optional(),
  sourceQuote: z.string().min(3),
});

const responseSchema = z.object({
  events: z.array(eventSchema).max(50),
});

export type ExtractedEvent = z.infer<typeof eventSchema>;

export interface LlmExtractInput {
  pageText: string;
  pageTitle: string;
  pageUrl: string;
  venueName: string;
  venueCity: string;
  venueRegion: string | null;
  /** "theatre productions" | "concerts" | "comedy shows" — derived by caller. */
  venueDescriptor: string;
  /** ISO YYYY-MM-DD, used to instruct the LLM to skip past dates. */
  todayISO: string;
}

export interface LlmExtractResult {
  events: ExtractedEvent[];
  rejected: ExtractedEvent[];
  tokensUsed: number;
}

/**
 * Build the system prompt server-side using venue context. Users do NOT
 * supply prompt text — only the URL — so this prompt is the only thing
 * directing extraction.
 */
function buildSystemPrompt(input: LlmExtractInput): string {
  const region = input.venueRegion ? `, ${input.venueRegion}` : '';
  return [
    `You extract upcoming live events from a webpage for the venue`,
    `"${input.venueName}" located in ${input.venueCity}${region}.`,
    `This venue typically hosts ${input.venueDescriptor}.`,
    `Today's date is ${input.todayISO}. Only include events on or after today.`,
    `For multi-night theatre productions, return a single entry with both`,
    `startDate and endDate set to the run's first and last performance.`,
    `For each event, include a "sourceQuote" — a short verbatim substring`,
    `from the page that proves the event exists. The substring must be`,
    `directly quotable; do not paraphrase.`,
    `Return at most 50 events. Reply with JSON only, no commentary.`,
  ].join(' ');
}

/**
 * Call Groq with structured-output mode and validate every returned event
 * against `responseSchema`. Drop any event whose `sourceQuote` is not a
 * substring of the rendered page text — that's the anti-hallucination guard.
 */
export async function extractEventsFromPage(
  input: LlmExtractInput,
): Promise<LlmExtractResult> {
  const systemPrompt = buildSystemPrompt(input);
  const userPrompt = `Page title: ${input.pageTitle}\nPage URL: ${input.pageUrl}\n\nPage content:\n${input.pageText}`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];

  const completion = await traceLLM({
    name: 'scrapers.extractEventsFromPage',
    model: 'llama-3.3-70b-versatile',
    input: messages,
    modelParameters: { temperature: 0.1, response_format: 'json_object', max_tokens: 4000 },
    metadata: { venueName: input.venueName, venueCity: input.venueCity, pageUrl: input.pageUrl },
    run: () =>
      groq().chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: 4000,
      }),
    extractUsage: groqUsage,
    extractOutput: (c) => c.choices[0]?.message?.content ?? null,
  });

  const tokensUsed = completion.usage?.total_tokens ?? 0;
  const raw = completion.choices[0]?.message?.content ?? '{}';

  let parsed: { events: ExtractedEvent[] };
  try {
    const obj = JSON.parse(raw);
    parsed = responseSchema.parse(obj);
  } catch (err) {
    log.error({ err, event: 'scrapers.llm.schema_invalid', pageUrl: input.pageUrl }, 'Schema validation failed');
    return { events: [], rejected: [], tokensUsed };
  }

  const accepted: ExtractedEvent[] = [];
  const rejected: ExtractedEvent[] = [];

  // Anti-hallucination: every event must include a sourceQuote that appears
  // verbatim in the page text. We do a case-insensitive whitespace-tolerant
  // check to avoid false negatives from minor formatting differences.
  const haystack = normalizeForQuoteMatch(input.pageText);
  for (const event of parsed.events) {
    const needle = normalizeForQuoteMatch(event.sourceQuote);
    if (needle.length >= 3 && haystack.includes(needle)) {
      accepted.push(event);
    } else {
      rejected.push(event);
    }
  }

  return { events: accepted, rejected, tokensUsed };
}

function normalizeForQuoteMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
