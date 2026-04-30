import Groq from 'groq-sdk';
import { traceLLM, groqUsage } from '@showbook/observability';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedShowInput {
  headliner: string;
  venue_hint: string | null;
  date_hint: string | null;
  seat_hint: string | null;
  kind_hint: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
}

export interface CastMember {
  actor: string;
  role: string;
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

let _groq: Groq | null = null;
function groq(): Groq {
  if (_groq) return _groq;
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set — cannot use Groq features.');
  }
  _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

const MODEL_TEXT = 'llama-3.3-70b-versatile';
const MODEL_VISION = 'meta-llama/llama-4-scout-17b-16e-instruct';

function pickContent(result: { choices: Array<{ message: { content: string | null } }> }): string | null {
  return result.choices[0]?.message?.content ?? null;
}

// ---------------------------------------------------------------------------
// parseShowInput — free-text → structured show fields
// ---------------------------------------------------------------------------

export async function parseShowInput(
  freeText: string,
): Promise<ParsedShowInput> {
  const messages = [
    {
      role: 'system' as const,
      content:
        'You are a structured data extractor for a show tracking app. Extract show details from the user\'s free-text input. Return ONLY a JSON object with these fields: headliner (string), venue_hint (string or null), date_hint (string or null), seat_hint (string or null), kind_hint (one of: concert, theatre, comedy, festival, or null). If a field cannot be determined, set it to null.',
    },
    { role: 'user' as const, content: freeText },
  ];

  const result = await traceLLM({
    name: 'groq.parseShowInput',
    model: MODEL_TEXT,
    input: messages,
    modelParameters: { response_format: 'json_object' },
    run: () =>
      groq().chat.completions.create({
        model: MODEL_TEXT,
        messages,
        response_format: { type: 'json_object' },
      }),
    extractUsage: groqUsage,
    extractOutput: pickContent,
  });

  const content = pickContent(result);
  if (!content) {
    throw new Error('No response from Groq');
  }

  try {
    return JSON.parse(content) as ParsedShowInput;
  } catch {
    throw new Error(
      `Failed to parse Groq response as JSON: ${content.slice(0, 200)}`,
    );
  }
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
    {
      role: 'system' as const,
      content:
        'You are a structured data extractor for a LIVE ENTERTAINMENT tracker (concerts, theatre, comedy shows, music festivals). Given an email, determine if it is a ticket confirmation for a live entertainment event and extract ALL available details.\n\n' +
        'Return ONLY a JSON object with these fields:\n' +
        '- headliner (string): the main performer or artist name. For festivals, this is the top-billed act. For theatre/broadway, this is the lead performer if known.\n' +
        '- production_name (string or null): for festivals, the festival name (e.g. "Governors Ball", "Coachella"). For theatre/broadway, the show title (e.g. "Wicked", "Hamilton"). Null for concerts and comedy.\n' +
        '- venue_name (string or null): the venue name. Look carefully — it is usually near the date and address. Examples: "Fox Theater", "Madison Square Garden", "The Fillmore".\n' +
        '- venue_city (string or null): the city. Often appears after the venue name or in the address line.\n' +
        '- venue_state (string or null): the full state or region name (e.g. "California", "New York", "Texas"), never abbreviations\n' +
        '- date (string or null): the event date in YYYY-MM-DD format. Look for dates in ANY format (e.g. "Sun · Aug 16, 2026", "March 15, 2025", "03/15/2025") and convert to YYYY-MM-DD.\n' +
        '- seat (string or null): section, row, and seat info combined\n' +
        '- price (string or null): total price paid as a decimal string\n' +
        '- ticket_count (number or null): number of tickets purchased (e.g. 2 if "Qty: 2")\n' +
        '- kind_hint (one of: concert, theatre, comedy, festival, or null)\n' +
        '- confidence (one of: high, medium, low): how confident you are this is a ticket for a live entertainment event\n\n' +
        'IMPORTANT: Extract EVERY field you can find. Do not leave fields null if the information is anywhere in the email. Scan the ENTIRE email body carefully.\n\n' +
        'DATE YEAR: The email Date header tells you WHEN the email was sent. Ticket confirmation emails are sent BEFORE the event. ' +
        'The event date should be on or after the email send date, typically within 0-12 months. ' +
        'If the email body shows a date without a year (e.g. "March 15" or "Sat, Aug 16"), use the email Date header to determine the correct year. ' +
        'The event year should NEVER be before the year the email was sent.\n\n' +
        'ONLY extract tickets for: concerts, music festivals, theatre/broadway shows, comedy shows, and other live performances with artists/performers.\n\n' +
        'Return {"confidence": "low", "headliner": ""} with all other fields null for ANY of these:\n' +
        '- Museum, gallery, or exhibition tickets\n' +
        '- Merchandise, posters, or physical goods orders\n' +
        '- Bus, shuttle, or transportation tickets (even if related to a festival)\n' +
        '- Sports events, theme parks, tours, or experiences\n' +
        '- Marketing emails, newsletters, or shipping notifications\n' +
        '- Parking passes or camping passes',
    },
    {
      role: 'user' as const,
      content: `Subject: ${emailSubject}\nFrom: ${emailFrom}\nDate: ${emailDate ?? 'unknown'}\n\n${emailBody.slice(0, 8000)}`,
    },
  ];

  let result;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      result = await traceLLM({
        name: 'groq.extractShowFromEmail',
        model: MODEL_TEXT,
        input: messages,
        modelParameters: { response_format: 'json_object' },
        metadata: { attempt },
        run: () =>
          groq().chat.completions.create({
            model: MODEL_TEXT,
            messages,
            response_format: { type: 'json_object' },
          }),
        extractUsage: groqUsage,
        extractOutput: pickContent,
      });
      break;
    } catch (err: unknown) {
      const e = err as { status?: number; headers?: { get?: (k: string) => string | null } };
      if (e.status === 429 && attempt < retries) {
        const retryAfter = e.headers?.get?.('retry-after');
        const waitMs = retryAfter ? Math.ceil(parseFloat(retryAfter) * 1000) : 300;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return null;
    }
  }

  const content = result ? pickContent(result) : null;
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as ExtractedTicketInfo;
    if (!parsed.headliner || parsed.confidence === 'low') return null;
    return parsed;
  } catch {
    return null;
  }
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
    modelParameters: { response_format: 'json_object' },
    metadata: { ticketCount: tickets.length },
    run: () =>
      groq().chat.completions.create({
        model: MODEL_TEXT,
        messages,
        response_format: { type: 'json_object' },
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
    {
      role: 'system' as const,
      content:
        'You are a structured data extractor for a LIVE ENTERTAINMENT tracker. ' +
        'Given text extracted from a PDF ticket or receipt, extract ALL available details.\n\n' +
        'Return ONLY a JSON object with these fields:\n' +
        '- headliner (string): the main performer or artist name. For festivals, the top-billed act. For theatre, the lead performer if known.\n' +
        '- production_name (string or null): for festivals, the festival name (e.g. "Governors Ball"). For theatre, the show title (e.g. "Wicked"). Null for concerts and comedy.\n' +
        '- venue_name (string or null): the venue name\n' +
        '- venue_city (string or null): the city\n' +
        '- venue_state (string or null): the full state or region name (e.g. "California", "New York", "Texas"), never abbreviations\n' +
        '- date (string or null): the event date in YYYY-MM-DD format\n' +
        '- seat (string or null): section, row, and seat info combined\n' +
        '- price (string or null): total price paid as a decimal string\n' +
        '- ticket_count (number or null): number of tickets purchased\n' +
        '- kind_hint (one of: concert, theatre, comedy, festival, or null)\n' +
        '- confidence (one of: high, medium, low)\n\n' +
        'Extract EVERY field you can find. Do not leave fields null if the information is anywhere in the text.',
    },
    { role: 'user' as const, content: pdfText.slice(0, 8000) },
  ];

  const result = await traceLLM({
    name: 'groq.extractShowFromPdfText',
    model: MODEL_TEXT,
    input: messages,
    modelParameters: { response_format: 'json_object' },
    run: () =>
      groq().chat.completions.create({
        model: MODEL_TEXT,
        messages,
        response_format: { type: 'json_object' },
      }),
    extractUsage: groqUsage,
    extractOutput: pickContent,
  });

  const raw = pickContent(result);
  if (!raw) throw new Error('No response from Groq');

  try {
    return JSON.parse(raw) as ExtractedTicketInfo;
  } catch {
    throw new Error(`Failed to parse Groq response: ${raw.slice(0, 200)}`);
  }
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
        {
          type: 'text',
          text: 'Extract the principal cast list from this playbill photo. Return ONLY a JSON object with a "cast" key containing an array of objects with "actor" and "role" fields. Skip ensemble, swing, understudy, dance captain, fight captain, music director, and orchestra listings. Example: {"cast": [{"actor": "Cynthia Erivo", "role": "Elphaba"}]}',
        },
      ],
    },
  ];

  const result = await traceLLM({
    name: 'groq.extractCast',
    model: MODEL_VISION,
    input: tracedInput,
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
              {
                type: 'text',
                text: 'Extract the principal cast list from this playbill photo. Return ONLY a JSON object with a "cast" key containing an array of objects with "actor" and "role" fields. Skip ensemble, swing, understudy, dance captain, fight captain, music director, and orchestra listings. Example: {"cast": [{"actor": "Cynthia Erivo", "role": "Elphaba"}]}',
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      }),
    extractUsage: groqUsage,
    extractOutput: pickContent,
  });

  const content = pickContent(result);
  if (!content) {
    throw new Error('No response from Groq');
  }

  try {
    const parsed = JSON.parse(content);
    return (parsed.cast || []) as CastMember[];
  } catch {
    throw new Error(
      `Failed to parse Groq response as JSON: ${content.slice(0, 200)}`,
    );
  }
}
