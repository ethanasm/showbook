import Groq from 'groq-sdk';

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
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  date: string | null;
  seat: string | null;
  price: string | null;
  kind_hint: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
  confidence: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ---------------------------------------------------------------------------
// parseShowInput — free-text → structured show fields
// ---------------------------------------------------------------------------

export async function parseShowInput(
  freeText: string,
): Promise<ParsedShowInput> {
  const result = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content:
          'You are a structured data extractor for a show tracking app. Extract show details from the user\'s free-text input. Return ONLY a JSON object with these fields: headliner (string), venue_hint (string or null), date_hint (string or null), seat_hint (string or null), kind_hint (one of: concert, theatre, comedy, festival, or null). If a field cannot be determined, set it to null.',
      },
      {
        role: 'user',
        content: freeText,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const content = result.choices[0]?.message?.content;
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
  retries = 3,
): Promise<ExtractedTicketInfo | null> {
  let result;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      result = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content:
          'You are a structured data extractor for a LIVE ENTERTAINMENT tracker (concerts, theatre, comedy shows, music festivals). Given an email, determine if it is a ticket confirmation for a live entertainment event and extract ALL available details.\n\n' +
          'Return ONLY a JSON object with these fields:\n' +
          '- headliner (string): the main performer, artist, or show name. Extract the ARTIST name, not the tour name.\n' +
          '- venue_name (string or null): the venue name. Look carefully — it is usually near the date and address. Examples: "Fox Theater", "Madison Square Garden", "The Fillmore".\n' +
          '- venue_city (string or null): the city. Often appears after the venue name or in the address line.\n' +
          '- venue_state (string or null): the full state or region name (e.g. "California", "New York", "Texas"), never abbreviations\n' +
          '- date (string or null): the event date in YYYY-MM-DD format. Look for dates in ANY format (e.g. "Sun · Aug 16, 2026", "March 15, 2025", "03/15/2025") and convert to YYYY-MM-DD.\n' +
          '- seat (string or null): section, row, and seat info combined\n' +
          '- price (string or null): total price paid as a decimal string\n' +
          '- kind_hint (one of: concert, theatre, comedy, festival, or null)\n' +
          '- confidence (one of: high, medium, low): how confident you are this is a ticket for a live entertainment event\n\n' +
          'IMPORTANT: Extract EVERY field you can find. Do not leave fields null if the information is anywhere in the email. Scan the ENTIRE email body carefully.\n\n' +
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
        role: 'user',
        content: `Subject: ${emailSubject}\nFrom: ${emailFrom}\n\n${emailBody.slice(0, 8000)}`,
      },
    ],
    response_format: { type: 'json_object' },
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

  const content = result?.choices[0]?.message?.content;
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

  const result = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content:
          'You are a data cleanup assistant for a live entertainment tracker.\n\n' +
          'Given a JSON array of extracted ticket records, return a cleaned array that:\n' +
          '1. MERGES duplicates — same artist + same date, or same artist + same venue = combine into one entry. Take the most complete data from each (e.g. one has the price, another has the seat — merge both into one record)\n' +
          '2. NORMALIZES headliner names (consistent casing, remove "presents" suffixes, etc.)\n' +
          '3. VALIDATES dates are in YYYY-MM-DD format\n\n' +
          'DO NOT remove entries. Only merge duplicates and clean up data. Keep everything else as-is.\n\n' +
          'Return ONLY a JSON object with a "tickets" key containing the cleaned array. Preserve all original fields.',
      },
      {
        role: 'user',
        content: JSON.stringify(tickets),
      },
    ],
    response_format: { type: 'json_object' },
  });

  const content = result.choices[0]?.message?.content;
  if (!content) return tickets;

  try {
    const parsed = JSON.parse(content) as { tickets: T[] };
    return parsed.tickets ?? tickets;
  } catch {
    return tickets;
  }
}

// ---------------------------------------------------------------------------
// extractCast — playbill image → principal cast list
// ---------------------------------------------------------------------------

export async function extractShowFromPdfText(
  pdfText: string,
): Promise<ExtractedTicketInfo> {
  const result = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content:
          'You are a structured data extractor for a LIVE ENTERTAINMENT tracker. ' +
          'Given text extracted from a PDF ticket or receipt, extract ALL available details.\n\n' +
          'Return ONLY a JSON object with these fields:\n' +
          '- headliner (string): the main performer, artist, or show name\n' +
          '- venue_name (string or null): the venue name\n' +
          '- venue_city (string or null): the city\n' +
          '- venue_state (string or null): the full state or region name (e.g. "California", "New York", "Texas"), never abbreviations\n' +
          '- date (string or null): the event date in YYYY-MM-DD format\n' +
          '- seat (string or null): section, row, and seat info combined\n' +
          '- price (string or null): total price paid as a decimal string\n' +
          '- kind_hint (one of: concert, theatre, comedy, festival, or null)\n' +
          '- confidence (one of: high, medium, low)\n\n' +
          'Extract EVERY field you can find. Do not leave fields null if the information is anywhere in the text.',
      },
      {
        role: 'user',
        content: pdfText.slice(0, 8000),
      },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = result.choices[0]?.message?.content;
  if (!raw) throw new Error('No response from Groq');

  try {
    return JSON.parse(raw) as ExtractedTicketInfo;
  } catch {
    throw new Error(`Failed to parse Groq response: ${raw.slice(0, 200)}`);
  }
}

export async function extractCast(
  imageBase64: string,
): Promise<CastMember[]> {
  const result = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
          },
          {
            type: 'text',
            text: 'Extract the principal cast list from this playbill photo. Return ONLY a JSON object with a "cast" key containing an array of objects with "actor" and "role" fields. Skip ensemble, swing, and understudy listings. Example: {"cast": [{"actor": "Cynthia Erivo", "role": "Elphaba"}]}',
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });

  const content = result.choices[0]?.message?.content;
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
