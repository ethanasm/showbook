/**
 * Date input normalization for the add/edit show form.
 *
 * The form's date field is a plain `TextInput` (no native date picker
 * yet), and users reach it through three paths that all produce
 * subtly different strings:
 *
 *   - The chat-mode Add screen pipes Groq's `date_hint` straight in.
 *     Groq is *supposed* to return YYYY-MM-DD but sometimes echoes
 *     "August 5, 2018" / "8/5/2018" / "Aug 5" instead.
 *   - iOS soft-keyboard "smart punctuation" replaces a typed hyphen
 *     with an en-dash (`–`, U+2013) inside dates and time ranges.
 *     The resulting string looks identical to YYYY-MM-DD but fails
 *     the literal `/^\d{4}-\d{2}-\d{2}$/` validator. Users see
 *     "Date must be YYYY-MM-DD" after typing what looks like exactly
 *     that, with no way to tell what's wrong.
 *   - Edit hydration always gets a clean ISO date from the server,
 *     but we still pipe it through the normalizer so the field is
 *     consistent.
 *
 * Goal: accept anything a reasonable user would consider a date and
 * canonicalize it to YYYY-MM-DD. If we can't parse it, return the
 * dash-normalized string unchanged so the user can keep editing.
 */

const MONTHS_LONG: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};
const MONTHS_SHORT: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  // may is in MONTHS_LONG; including it here too for completeness
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  sept: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/**
 * Replace common dash-shaped Unicode codepoints with ASCII hyphen.
 * Covers: en-dash (U+2013), em-dash (U+2014), figure dash (U+2012),
 * horizontal bar (U+2015), minus sign (U+2212), small hyphen-minus
 * (U+FE63), fullwidth hyphen-minus (U+FF0D). Leaves the regular ASCII
 * hyphen (U+002D) untouched.
 *
 * Exported so the form can pre-normalize a user's keystroke without
 * going through the whole date parser — they're allowed to type
 * partial input ("2018-") without us erasing or rewriting it.
 */
export function normalizeDashes(input: string): string {
  return input.replace(/[‐-―−﹘﹣－]/g, '-');
}

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const US_SLASH_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;
const US_DASH_RE = /^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/;
const MONTH_WORD_RE =
  /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(\d{4})$/;
const MONTH_WORD_NO_YEAR_RE = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidIso(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Quick day-by-month check — leap years for Feb. Avoids needing a
  // full Date validity check, which is timezone-sensitive.
  const monthDays = [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return day <= (leap ? 29 : 28);
  }
  return day <= monthDays[month - 1];
}

function buildIso(year: number, month: number, day: number): string | null {
  if (!isValidIso(year, month, day)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function expandTwoDigitYear(yy: number): number {
  // Two-digit years are ambiguous — use a 50-year window centered
  // around today: 00-49 → 2000s, 50-99 → 1900s. Good enough for
  // show-tracking; users entering "8/5/24" almost certainly mean
  // 2024, not 1924.
  return yy < 50 ? 2000 + yy : 1900 + yy;
}

function monthFromWord(word: string): string | null {
  const key = word.toLowerCase().replace(/\.$/, '');
  return MONTHS_LONG[key] ?? MONTHS_SHORT[key] ?? null;
}

/**
 * Best-effort conversion to YYYY-MM-DD. Returns null if the input
 * doesn't match any known format.
 *
 * Recognized formats:
 *   - 2018-08-05  (already ISO; only validates calendar)
 *   - 8/5/2018, 08/05/2018, 8/5/18  (US m/d/y)
 *   - 8-5-2018, 8-5-18  (US m-d-y)
 *   - August 5, 2018 / Aug 5, 2018 / Aug 5 2018 / Aug. 5, 2018
 *   - August 5 (assumes the current calendar year)
 */
export function parseToIso(
  input: string,
  options: { now?: Date } = {},
): string | null {
  const trimmed = normalizeDashes(input).trim();
  if (trimmed.length === 0) return null;
  const now = options.now ?? new Date();

  let m: RegExpExecArray | null;

  if ((m = ISO_RE.exec(trimmed))) {
    return buildIso(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  if ((m = US_SLASH_RE.exec(trimmed)) || (m = US_DASH_RE.exec(trimmed))) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const yearRaw = Number(m[3]);
    const year = m[3].length === 2 ? expandTwoDigitYear(yearRaw) : yearRaw;
    return buildIso(year, month, day);
  }

  if ((m = MONTH_WORD_RE.exec(trimmed))) {
    const month = monthFromWord(m[1]);
    if (!month) return null;
    return buildIso(Number(m[3]), Number(month), Number(m[2]));
  }

  if ((m = MONTH_WORD_NO_YEAR_RE.exec(trimmed))) {
    const month = monthFromWord(m[1]);
    if (!month) return null;
    return buildIso(now.getFullYear(), Number(month), Number(m[2]));
  }

  return null;
}

/**
 * Normalize a date string for display in the form field. If the
 * input is a parseable date, returns YYYY-MM-DD. Otherwise returns
 * the dash-normalized input so partial typing isn't disrupted.
 *
 * Use this when receiving a date from an external source
 * (Groq's `date_hint`, chat search params) or when the user finishes
 * editing the field. For in-progress keystrokes, use `normalizeDashes`
 * directly — it's lossless.
 */
export function normalizeDateInput(input: string, options: { now?: Date } = {}): string {
  if (typeof input !== 'string') return '';
  const parsed = parseToIso(input, options);
  if (parsed) return parsed;
  return normalizeDashes(input);
}

/**
 * Strict YYYY-MM-DD predicate — the form uses this for validation
 * before submit. Matches the existing inline check we replaced.
 */
export function isYmd(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(input.trim());
}
