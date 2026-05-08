/**
 * Pre-LLM heuristic scorer for the Gmail scan path. Returns 0-100 based on
 * how ticket-confirmation-shaped an email looks. Callers skip the Groq
 * extraction when the score falls below `HEURISTIC_THRESHOLD`.
 *
 * Calibrated against:
 * - Positive set (score ≥ 30): real ticket confirmations from Ticketmaster,
 *   AXS, DICE, SeatGeek, Telecharge, TodayTix, Eventbrite, regional venues.
 * - Negative set (score < 30): museum admissions, parking passes, shipping
 *   notifications, marketing newsletters, flight/hotel itineraries.
 *
 * Pure function: same input → same score. Adjust weights below; do not
 * couple to runtime state.
 */

export const HEURISTIC_THRESHOLD = 30;

interface ScoreInput {
  subject: string;
  body: string;
  from: string;
}

const TICKET_KEYWORDS = [
  /\bticket(s)?\b/i,
  /\border (confirmation|number|#)/i,
  /\bconfirmation\b/i,
  /\b(your|the) (event|show|performance)\b/i,
  /\bdoors? open\b/i,
  /\bvenue\b/i,
  /\bseat(s|ing)?\b/i,
  /\bsection\b/i,
  /\brow\b/i,
  /\b(general admission|GA)\b/i,
  /\be-?ticket\b/i,
  /\bbooking\b/i,
];

const NEGATIVE_KEYWORDS = [
  /\bmuseum\b/i,
  /\bparking pass\b/i,
  /\b(camping|shuttle|bus pass)\b/i,
  /\b(shipped|tracking number|shipping)\b/i,
  /\bflight (confirmation|itinerary)\b/i,
  /\bhotel reservation\b/i,
  /\bnewsletter\b/i,
  /\bunsubscribe from\b/i,
];

const DATE_PATTERNS = [
  // Mon, Aug 16, 2026 / Sun · Aug 16, 2026
  // Single character class avoids overlapping quantifiers (CodeQL ReDoS).
  /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*[,.\s·]+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i,
  // March 15, 2026
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s*\d{4})?\b/i,
  // 03/15/2026 or 3-15-26
  /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/,
  // 2026-03-15
  /\b\d{4}-\d{2}-\d{2}\b/,
];

const PRICE_PATTERN = /\$\s?\d+(?:\.\d{2})?\b/;
// Single character class for the optional separator avoids the overlapping
// `\s*…\s*` quantifiers CodeQL flags as polynomial ReDoS.
const QTY_PATTERN = /\b(?:qty|quantity|tickets?)[\s:#]*\d+\b/i;
const VENUE_HINT_PATTERN = /\b(theatre|theater|hall|arena|stadium|amphitheater|amphitheatre|club|ballroom|coliseum|forum|fillmore|garden|pavilion)\b/i;

export function scoreEmailLikelyTicket(input: ScoreInput): number {
  const subject = input.subject ?? '';
  const body = input.body ?? '';
  const from = input.from ?? '';
  const haystack = `${subject}\n${body}`;

  let score = 0;

  for (const re of TICKET_KEYWORDS) {
    if (re.test(haystack)) score += 8;
  }

  for (const re of DATE_PATTERNS) {
    if (re.test(haystack)) {
      score += 15;
      break;
    }
  }

  if (PRICE_PATTERN.test(haystack)) score += 8;
  if (QTY_PATTERN.test(haystack)) score += 10;
  if (VENUE_HINT_PATTERN.test(haystack)) score += 12;

  // Sender-side hints — domain looks ticket-shaped. Plain substring +
  // anchored checks instead of one big regex with `.*`, which CodeQL
  // flags as polynomial ReDoS.
  const fromLower = from.toLowerCase();
  if (
    fromLower.includes('ticket') ||
    fromLower.includes('boxoffice') ||
    fromLower.includes('box-office') ||
    /\borders?@/.test(fromLower) ||
    (fromLower.startsWith('noreply@') && /\.(?:fm|com)\b/.test(fromLower))
  ) {
    score += 8;
  }

  for (const re of NEGATIVE_KEYWORDS) {
    if (re.test(haystack)) score -= 25;
  }

  // A non-trivial body length is a weak positive signal — totally empty
  // bodies tend to be auto-generated bounces / receipts that don't mention
  // a real event.
  if (body.length > 500) score += 4;

  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}
