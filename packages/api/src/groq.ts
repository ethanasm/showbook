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
): Promise<ExtractedTicketInfo | null> {
  const result = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content:
          'You are a structured data extractor. Given a ticket confirmation email, extract the event details. Return ONLY a JSON object with these fields:\n' +
          '- headliner (string): the main performer, artist, or show name\n' +
          '- venue_name (string or null): the venue where the event takes place\n' +
          '- venue_city (string or null): the city of the venue\n' +
          '- date (string or null): the event date in YYYY-MM-DD format\n' +
          '- seat (string or null): section, row, and seat info combined\n' +
          '- price (string or null): total price paid as a decimal string\n' +
          '- kind_hint (one of: concert, theatre, comedy, festival, or null)\n' +
          '- confidence (one of: high, medium, low): how confident you are this is a real ticket confirmation\n\n' +
          'If this is NOT a ticket confirmation (e.g. marketing email, newsletter, shipping notification), return {"confidence": "low", "headliner": ""} with all other fields null.',
      },
      {
        role: 'user',
        content: `Subject: ${emailSubject}\nFrom: ${emailFrom}\n\n${emailBody.slice(0, 4000)}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const content = result.choices[0]?.message?.content;
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
// extractCast — playbill image → principal cast list
// ---------------------------------------------------------------------------

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
