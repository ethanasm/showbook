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
  const d = new Date(date);
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

function parseLocalDate(date: string | Date): Date {
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
