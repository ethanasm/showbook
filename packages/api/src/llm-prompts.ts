/**
 * Long-form system prompts for the Groq-backed extraction helpers.
 * Centralized so the prompt text is searchable, diff-friendly, and not
 * obscuring the request-shaping logic in `groq.ts`. Each constant is
 * the exact string handed to the model as the `system` (or, for vision
 * calls, the `text`) message.
 */

// ─────────────────────────────────────────────────────────────────────
// parseShowInput — free-text → structured show fields
// ─────────────────────────────────────────────────────────────────────

/**
 * Static base prompt for `parseShowInput`. The conversation-context
 * section (`PARSE_SHOW_INPUT_CONTEXT_PREFIX` + bullet list) is appended
 * in the caller only when recent shows are passed.
 */
export const PARSE_SHOW_INPUT_BASE_PROMPT =
  'You are a structured data extractor for a show tracking app. ' +
  "Extract show details from the user's free-text input. Return ONLY a JSON object with these fields: " +
  'headliner (string or null), venue_hint (string or null), date_hint (string in strict YYYY-MM-DD format or null), ' +
  'seat_hint (string or null), kind_hint (one of: concert, theatre, comedy, festival, or null). ' +
  'For headliner: return the artist / production / comedian / festival name the user is describing. ' +
  'If the input is conversational (e.g. "I also saw him in 2016") with no specific name AND no usable ' +
  'context entry below, return null — the app will let the user fill it in. ' +
  'For date_hint: only emit YYYY-MM-DD (e.g. "2018-08-05"). If the user gives a partial date with no year, ' +
  'assume the closest future date; if no month/day at all, return null. Never emit prose like "August 5, 2018" ' +
  'or slash-separated dates. If any other field cannot be determined, set it to null.';

/** Prefix that introduces the bulleted recent-shows context block. */
export const PARSE_SHOW_INPUT_CONTEXT_PREFIX =
  '\n\nConversation context — the user has already discussed these shows in this session:\n';

/** Guidance on how to use the context block — appended after the bullet list. */
export const PARSE_SHOW_INPUT_CONTEXT_SUFFIX =
  '\n\nIf the new input uses a pronoun ("him", "her", "them", "they", "it") or a shorthand reference ' +
  '("also", "again", "another time", "that one"), resolve the reference to the headliner of the most ' +
  'recent matching show in the context above, and emit that resolved name in the `headliner` field — ' +
  'do NOT return null when a context entry can resolve the reference. ' +
  "Carry over `venue_hint` / `kind_hint` from the same context entry only if the user's new input " +
  'does not specify a different value; otherwise prefer the new input.';

// ─────────────────────────────────────────────────────────────────────
// extractShowFromEmail — ticket confirmation email → structured show data
// ─────────────────────────────────────────────────────────────────────

export const EXTRACT_SHOW_FROM_EMAIL_PROMPT =
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
  '- Parking passes or camping passes';

// ─────────────────────────────────────────────────────────────────────
// extractShowFromPdfText — PDF text → structured show data
// ─────────────────────────────────────────────────────────────────────

export const EXTRACT_SHOW_FROM_PDF_PROMPT =
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
  'Extract EVERY field you can find. Do not leave fields null if the information is anywhere in the text.';

// ─────────────────────────────────────────────────────────────────────
// extractCast — playbill image → principal cast list
// ─────────────────────────────────────────────────────────────────────

export const EXTRACT_CAST_PROMPT =
  'Extract the principal cast list from this playbill photo. Return ONLY a JSON object with a "cast" key containing an array of objects with "actor" and "role" fields. Skip ensemble, swing, understudy, dance captain, fight captain, music director, and orchestra listings. Example: {"cast": [{"actor": "Cynthia Erivo", "role": "Elphaba"}]}';

// ─────────────────────────────────────────────────────────────────────
// extractFestivalLineupFromImage / FromPdfText — poster or PDF → lineup
// ─────────────────────────────────────────────────────────────────────

export const FESTIVAL_LINEUP_INSTRUCTIONS =
  'You are extracting a music festival lineup. Read EVERY performing artist name. ' +
  'Tier the artists: the visually largest / topmost / boldest names are "headliner"; ' +
  'all other artists are "support". For text (PDF) input, use ALL-CAPS or top-of-grid ' +
  'lines as the headliner signal. Skip sponsor logos, presenter blurbs ("XYZ Presents…"), ' +
  'stage names, ticket pricing, and time-slot labels with no artist attached. If the ' +
  'festival name, dates, or venue appear on the source, extract them; otherwise null. ' +
  'Dates must be YYYY-MM-DD format — if the source only shows "June 6-8 2026", emit ' +
  'start_date "2026-06-06" and end_date "2026-06-08". ' +
  'Return ONLY a JSON object with this exact shape: ' +
  '{"festival_name": string|null, "start_date": string|null, "end_date": string|null, ' +
  '"venue_hint": string|null, "artists": [{"name": string, "tier": "headliner"|"support"}]}.';
