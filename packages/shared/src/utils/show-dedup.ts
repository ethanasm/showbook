/**
 * Fuzzy-match a user's logged show against an upcoming announcement so the
 * venue detail screen doesn't surface the same event twice — once under
 * "Your shows" and again under "Upcoming". Exact name match isn't enough:
 * a user uploading a festival poster typically saves "Bottlerock" while
 * Ticketmaster announces "BottleRock Napa Valley", and tour shows like
 * "Taylor Swift" map to "Taylor Swift: The Eras Tour". The same venue +
 * overlapping date + token-aware name prefix is a strong-enough signal to
 * collapse, and the false-positive risk is bounded by the venue+date narrowing.
 */

const LEADING_ARTICLE = /^(the|a|an)\s+/;

export function normalizeShowName(name: string | null | undefined): string {
  if (!name) return '';
  const cleaned = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.replace(LEADING_ARTICLE, '');
}

/**
 * Token-aware prefix match: `b` starts with `a` AND `a` ends on a word
 * boundary in `b`, so "rage" matches "rage against the machine" but not
 * "rageful". Requires a minimum prefix length to avoid pathological matches
 * on common short tokens.
 */
function tokenPrefix(a: string, b: string, minLen: number): boolean {
  if (a.length < minLen) return false;
  if (!b.startsWith(a)) return false;
  return b.length === a.length || b[a.length] === ' ';
}

function nameLikelyMatches(showName: string, announcementName: string): boolean {
  const a = normalizeShowName(showName);
  const b = normalizeShowName(announcementName);
  if (!a || !b) return false;
  if (a === b) return true;
  return tokenPrefix(a, b, 3) || tokenPrefix(b, a, 3);
}

export interface ShowForDedup {
  date: string | null;
  endDate: string | null;
  productionName: string | null;
  headlinerName: string | null;
}

export interface AnnouncementForDedup {
  showDate: string;
  runStartDate?: string | null;
  runEndDate?: string | null;
  performanceDates?: readonly string[] | null;
  productionName: string | null;
  headliner: string;
}

function datesOverlap(
  show: ShowForDedup,
  announcement: AnnouncementForDedup,
): boolean {
  const showStart = show.date;
  if (!showStart) return false;
  const showEnd = show.endDate ?? showStart;

  const annoStart = announcement.runStartDate ?? announcement.showDate;
  const annoEnd = announcement.runEndDate ?? announcement.showDate;
  if (annoEnd >= showStart && annoStart <= showEnd) return true;

  if (announcement.performanceDates) {
    for (const d of announcement.performanceDates) {
      if (d >= showStart && d <= showEnd) return true;
    }
  }
  return false;
}

export function showMatchesAnnouncement(
  show: ShowForDedup,
  announcement: AnnouncementForDedup,
): boolean {
  if (!datesOverlap(show, announcement)) return false;
  const showName = show.productionName ?? show.headlinerName ?? '';
  const annoName = announcement.productionName ?? announcement.headliner;
  return nameLikelyMatches(showName, annoName);
}
