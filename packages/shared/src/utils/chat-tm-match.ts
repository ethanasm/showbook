import { isDatePast } from './dates';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when a chat-parsed date hint is a usable calendar date that is
 * today or later. Ticketmaster's Discovery API only exposes upcoming
 * events, so a past — or absent / malformed — date means the chat flow
 * skips the "did you mean one of these?" lookup entirely.
 *
 * Shared between the web (`AddShowChat`) and mobile (`AddChatScreen`)
 * chat-add flows so both surfaces gate the Ticketmaster lookup on the
 * same "upcoming, not past" rule.
 */
export function isUpcomingDateHint(
  dateHint: string | null | undefined,
): dateHint is string {
  if (!dateHint || !ISO_DATE.test(dateHint)) return false;
  return !isDatePast(dateHint);
}

/**
 * A ±3-day ISO datetime window around the parsed date, passed to the
 * Ticketmaster event search as start/end bounds. The slop absorbs
 * timezone edges and small date-parsing misses so the event the user
 * described still surfaces among the matches.
 */
export function tmDateWindow(dateHint: string): {
  startDate: string;
  endDate: string;
} {
  const [y, m, d] = dateHint.split('-').map(Number);
  const base = Date.UTC(y!, m! - 1, d!);
  const DAY = 86_400_000;
  const iso = (ms: number) => `${new Date(ms).toISOString().split('.')[0]}Z`;
  return {
    startDate: iso(base - 3 * DAY),
    endDate: iso(base + 4 * DAY - 1000),
  };
}
