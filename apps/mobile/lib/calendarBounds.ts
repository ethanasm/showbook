/**
 * Bounds computation for the Shows tab Month view navigation.
 *
 * The Shows tab is split into Upcoming and Past buckets. The month
 * navigation should refuse to cross the "today" boundary in either
 * direction:
 *
 *   - Upcoming: can't go before the current month (no future shows
 *     can possibly exist there).
 *   - Past: can't go after the current month (no past shows can
 *     possibly exist there).
 *
 * The current month itself is always reachable in both buckets so
 * shows on today's date / earlier this month / later this month are
 * visible in the appropriate bucket.
 */

export interface MonthCursor {
  year: number;
  month: number;
}

export interface CalendarBounds {
  min: MonthCursor;
  max: MonthCursor;
}

export type StateBucket = 'upcoming' | 'past';

export function computeMonthBounds(params: {
  showDates: (string | null)[];
  stateBucket: StateBucket;
  today: MonthCursor;
}): CalendarBounds {
  const { showDates, stateBucket, today } = params;
  const years = showDates
    .map((d) => (d ? Number(d.slice(0, 4)) : NaN))
    .filter((y) => Number.isFinite(y));
  const dataMinYear = Math.min(today.year, ...years);
  const dataMaxYear = Math.max(today.year, ...years);

  if (stateBucket === 'upcoming') {
    return {
      min: { year: today.year, month: today.month },
      max: { year: dataMaxYear, month: 11 },
    };
  }
  return {
    min: { year: dataMinYear, month: 0 },
    max: { year: today.year, month: today.month },
  };
}

function compareCursors(a: MonthCursor, b: MonthCursor): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

export function atMinCursor(cursor: MonthCursor, bounds: CalendarBounds): boolean {
  return compareCursors(cursor, bounds.min) <= 0;
}

export function atMaxCursor(cursor: MonthCursor, bounds: CalendarBounds): boolean {
  return compareCursors(cursor, bounds.max) >= 0;
}

export function stepCursor(
  cursor: MonthCursor,
  delta: number,
  bounds: CalendarBounds,
): MonthCursor {
  const m = cursor.month + delta;
  let next: MonthCursor;
  if (m < 0) next = { year: cursor.year - 1, month: 11 };
  else if (m > 11) next = { year: cursor.year + 1, month: 0 };
  else next = { year: cursor.year, month: m };

  if (compareCursors(next, bounds.min) < 0) return cursor;
  if (compareCursors(next, bounds.max) > 0) return cursor;
  return next;
}
