export function countdown(date: string | Date): string {
  // Returns "12 days", "3 weeks", "tomorrow", "today", etc.
  const target = new Date(date);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return `${Math.abs(diffDays)} days ago`;
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays < 7) return `${diffDays} days`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months`;
  return `${Math.floor(diffDays / 365)} years`;
}

export function formatShowDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatYear(date: string | Date): number {
  return new Date(date).getFullYear();
}

export function isDatePast(date: string | Date): boolean {
  const d = parseLocalDate(date);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

// Convert Date to setlist.fm format dd-MM-yyyy. ISO date strings (YYYY-MM-DD)
// are zone-less calendar dates and must not go through `new Date`, which parses
// them as UTC midnight and shifts the day in zones west of UTC.
export function toSetlistFmDate(date: string | Date): string {
  if (typeof date === 'string') {
    const [y, m, d] = date.slice(0, 10).split('-');
    return `${d}-${m}-${y}`;
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

// ---------------------------------------------------------------------------
// Display formatters used by the web app's detail pages and rows.
//
// Date strings without an explicit time are anchored to local midnight by
// appending T00:00:00. This avoids the "off by one day" timezone bug that
// `new Date('2024-01-01')` causes (it gets parsed as UTC midnight).
// ---------------------------------------------------------------------------

// Parse a zone-less calendar date (YYYY-MM-DD) at local midnight. Bare
// `new Date('2024-01-01')` parses as UTC midnight, which shifts the day in
// zones west of UTC — exported so callers comparing show dates against
// `new Date()` (today) don't reintroduce that bug.
export function parseLocalDate(date: string | Date): Date {
  if (date instanceof Date) return date;
  return new Date(date.includes('T') ? date : `${date}T00:00:00`);
}

// "Jan 1, 2024" — used on artist and venue detail pages.
export function formatDateMedium(
  date: string | Date | null | undefined,
  fallback = '—',
): string {
  if (!date) return fallback;
  return parseLocalDate(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// "Monday, January 1, 2024" — used on the show detail page hero.
export function formatDateLong(
  date: string | Date | null | undefined,
  fallback = 'Date TBD',
): string {
  if (!date) return fallback;
  return parseLocalDate(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// "Monday, January 1 - Tuesday, January 2, 2024" for multi-night runs.
export function formatDateRangeLong(
  startDate: string | Date | null | undefined,
  endDate: string | Date | null | undefined,
  fallback = 'Date TBD',
): string {
  if (!startDate) return fallback;
  if (!endDate || endDate === startDate) return formatDateLong(startDate, fallback);

  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return formatDateLong(startDate, fallback);
  }

  const startLabel = start.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const endLabel = end.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startLabel} - ${endLabel}`;
}

// Compact uppercase range used in chrome strips (e.g. the mobile show-detail
// eyebrow). Single date → "AUG 9, 2024". Same month → "AUG 9–11, 2024".
// Cross-month / cross-year fall through to the longer "AUG 30 – SEP 2, 2024"
// or "DEC 30, 2024 – JAN 2, 2025" forms so the year is never ambiguous.
export function formatDateRangeShort(
  startDate: string | Date | null | undefined,
  endDate: string | Date | null | undefined,
  fallback = 'DATE TBD',
): string {
  if (!startDate) return fallback;
  const start = parseLocalDate(startDate);
  if (isNaN(start.getTime())) return fallback;

  const startMonth = start
    .toLocaleDateString('en-US', { month: 'short' })
    .toUpperCase();
  const startDay = start.getDate();
  const startYear = start.getFullYear();
  const single = `${startMonth} ${startDay}, ${startYear}`;

  if (!endDate || endDate === startDate) return single;
  const end = parseLocalDate(endDate);
  if (isNaN(end.getTime())) return single;

  const endMonth = end
    .toLocaleDateString('en-US', { month: 'short' })
    .toUpperCase();
  const endDay = end.getDate();
  const endYear = end.getFullYear();
  if (end.getTime() <= start.getTime()) return single;

  if (startYear === endYear && start.getMonth() === end.getMonth()) {
    return `${startMonth} ${startDay}–${endDay}, ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${startYear}`;
  }
  return `${startMonth} ${startDay}, ${startYear} – ${endMonth} ${endDay}, ${endYear}`;
}

export interface DateParts {
  month: string;
  day: string;
  year: string;
  dow: string;
}

// Returns { month: 'JAN', day: '1', year: '2024', dow: 'Mon' } — canonical
// capitalization. Callers can lowercase any field if a specific style needs
// it (a handful of detail rows render dow lowercase).
export function formatDateParts(
  date: string | Date | null | undefined,
  fallback: DateParts = { month: 'TBD', day: '', year: '—', dow: 'date' },
): DateParts {
  if (!date) return fallback;
  const d = parseLocalDate(date);
  if (isNaN(d.getTime())) return fallback;
  return {
    month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    day: String(d.getDate()),
    year: String(d.getFullYear()),
    dow: d.toLocaleDateString('en-US', { weekday: 'short' }),
  };
}

// "Jan 1" — used by on-sale chips and announcement rails.
export function formatOnSaleDate(
  value: Date | string | null | undefined,
  fallback = '—',
): string {
  if (!value) return fallback;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Whole calendar days from now until `date` (negative if in the past).
export function daysUntil(date: string | Date | null | undefined): number {
  if (!date) return 0;
  const now = new Date();
  const d = parseLocalDate(date);
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
