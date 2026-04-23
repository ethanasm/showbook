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
