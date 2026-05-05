/**
 * Pure helpers for the M5 omnisearch screen.
 *
 * Extracted from `app/search.tsx` so they can be unit-tested without
 * pulling in React Native. No imports from `react-native`, `expo-*`, or
 * `lucide-react-native` belong in this file.
 */

export interface SearchShow {
  id: string;
  title: string;
  date: string | null;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival' | 'sports' | 'film' | 'unknown';
  state: 'past' | 'ticketed' | 'watching';
  venueName: string;
  venueCity: string | null;
}

export interface SearchPerformer {
  id: string;
  name: string;
  imageUrl: string | null;
  showCount: number;
}

export interface SearchVenue {
  id: string;
  name: string;
  city: string | null;
  showCount: number;
}

export interface RawGlobalResults {
  shows: SearchShow[];
  performers: SearchPerformer[];
  venues: SearchVenue[];
}

export type SearchEntityType = 'shows' | 'artists' | 'venues';

export interface SearchGroup<T> {
  type: SearchEntityType;
  items: T[];
  count: number;
}

export interface GroupedSearchResults {
  shows: SearchGroup<SearchShow>;
  artists: SearchGroup<SearchPerformer>;
  venues: SearchGroup<SearchVenue>;
  total: number;
}

/**
 * `true` when the trimmed query is empty. Callers should skip the
 * server round-trip when this returns `true`.
 */
export function isEmptyQuery(query: string | null | undefined): boolean {
  if (query == null) return true;
  return query.trim().length === 0;
}

/**
 * Group raw search results by entity type while preserving server
 * ordering and per-group counts. Empty inputs (or null) produce empty
 * groups so the UI can render a uniform shape without null-checks.
 */
export function groupResults(raw: RawGlobalResults | null | undefined): GroupedSearchResults {
  const shows = raw?.shows ?? [];
  const performers = raw?.performers ?? [];
  const venues = raw?.venues ?? [];
  return {
    shows: { type: 'shows', items: shows, count: shows.length },
    artists: { type: 'artists', items: performers, count: performers.length },
    venues: { type: 'venues', items: venues, count: venues.length },
    total: shows.length + performers.length + venues.length,
  };
}

export interface HighlightMatch {
  before: string;
  match: string;
  after: string;
}

/**
 * Extract a small window around the first case-insensitive match of
 * `query` in `text`, returning the substring fragments before, during,
 * and after the match. Returns `null` when there is no match or when
 * either input is empty.
 *
 * `contextChars` is the maximum width of each side fragment; the
 * window is trimmed at word boundaries when possible.
 */
export function extractHighlight(
  text: string | null | undefined,
  query: string | null | undefined,
  contextChars = 20,
): HighlightMatch | null {
  if (!text || !query) return null;
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return null;

  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + trimmed.length + contextChars);

  let before = text.slice(start, idx);
  if (start > 0) {
    const spaceIdx = before.indexOf(' ');
    if (spaceIdx > 0 && spaceIdx < before.length - 1) {
      before = `…${before.slice(spaceIdx + 1)}`;
    } else {
      before = `…${before}`;
    }
  }

  const match = text.slice(idx, idx + trimmed.length);

  let after = text.slice(idx + trimmed.length, end);
  if (end < text.length) {
    const lastSpace = after.lastIndexOf(' ');
    if (lastSpace > 0) {
      after = `${after.slice(0, lastSpace)}…`;
    } else {
      after = `${after}…`;
    }
  }

  return { before, match, after };
}
