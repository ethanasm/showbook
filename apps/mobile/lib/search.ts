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
  kind: 'concert' | 'theatre' | 'comedy' | 'festival' | 'film' | 'unknown';
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

/**
 * An upcoming Ticketmaster show — the "Future shows" section of the
 * omnisearch screen. Mirrors the `search.futureShows` tRPC payload.
 */
export interface FutureShow {
  tmEventId: string;
  title: string;
  date: string;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival';
  venueName: string;
  venueCity: string | null;
  performers: { name: string; tmAttractionId: string; imageUrl: string | null }[];
}

/**
 * Build the `/add/form` query params that pre-fill the add-show form
 * from a tapped future show. The form's `paramPerformers` decoder reads
 * `performersJson`; `kindHint` / `headliner` / `venueHint` / `venueCity`
 * / `dateHint` map straight onto the form fields.
 *
 * Performer detection is kind-aware:
 *   - concert / comedy: `title` is the headliner; the remaining
 *     attractions become support performers.
 *   - festival: `title` is the festival name; every attraction is a
 *     lineup row.
 *   - theatre: only the production — cast comes from a playbill, so no
 *     lineup is pre-filled.
 */
export function futureShowToFormParams(show: FutureShow): Record<string, string> {
  const toRow = (p: FutureShow['performers'][number]) => {
    const row: {
      name: string;
      tier: 'support';
      tmAttractionId?: string;
      imageUrl?: string;
    } = { name: p.name, tier: 'support' };
    if (p.tmAttractionId) row.tmAttractionId = p.tmAttractionId;
    if (p.imageUrl) row.imageUrl = p.imageUrl;
    return row;
  };

  let lineup: ReturnType<typeof toRow>[];
  if (show.kind === 'festival') {
    lineup = show.performers.map(toRow);
  } else if (show.kind === 'theatre') {
    lineup = [];
  } else {
    lineup = show.performers.slice(1).map(toRow);
  }

  const params: Record<string, string> = {
    kindHint: show.kind,
    headliner: show.title,
    venueHint: show.venueName,
    dateHint: show.date,
  };
  if (show.venueCity) params.venueCity = show.venueCity;
  if (lineup.length > 0) params.performersJson = JSON.stringify(lineup);
  return params;
}

/**
 * A not-yet-followed artist surfaced from Ticketmaster — the "Artists to
 * follow" section. Mirrors the `discover.searchArtists` tRPC payload (the
 * same query the Discover follow-artist sheet uses). `id` is the
 * Ticketmaster attraction id, so following resolves it into a local
 * performer via `performers.followAttraction`.
 */
export interface DiscoverArtist {
  id: string;
  name: string;
  imageUrl: string | null;
  mbid: string | null;
}

/**
 * A not-yet-followed venue surfaced from the catalog — the "Venues to
 * follow" section. Mirrors the fields the `venues.search` tRPC payload
 * exposes that this screen displays (the same query the Discover
 * follow-venue sheet uses). `id` is a local venue id, so the row links
 * straight into the venue detail screen.
 */
export interface DiscoverVenue {
  id: string;
  name: string;
  city: string | null;
}

/** Lowercased, whitespace-collapsed key for artist-name de-duplication. */
function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Reduce the raw `discover.searchArtists` payload to the artists worth
 * showing in the "Artists to follow" section:
 *   - drop any whose name already appears in the user's own (logged)
 *     artist results — those are surfaced in the "Artists" section and
 *     re-listing them as "to follow" reads as clutter;
 *   - drop intra-list duplicate names (Ticketmaster can return the same
 *     act under multiple attraction ids);
 *   - cap at `limit` so the discoverable rows stay a short tail under the
 *     log results rather than dominating the panel.
 *
 * Server order is preserved (Ticketmaster relevance ranking).
 */
export function dedupeDiscoverArtists(
  discover: DiscoverArtist[] | null | undefined,
  owned: SearchPerformer[] | null | undefined,
  limit = 6,
): DiscoverArtist[] {
  const seen = new Set<string>((owned ?? []).map((p) => nameKey(p.name)));
  const out: DiscoverArtist[] = [];
  for (const a of discover ?? []) {
    const key = nameKey(a.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Reduce the raw `venues.search` payload to the venues worth showing in
 * the "Venues to follow" section:
 *   - drop any whose id already appears in the user's own venue results
 *     (venues they have shows at or already follow — `search.global`
 *     covers both), so a followed/visited venue never re-lists as "to
 *     follow";
 *   - drop intra-list duplicate ids defensively;
 *   - cap at `limit`.
 *
 * Server order is preserved.
 */
export function dedupeDiscoverVenues(
  discover: DiscoverVenue[] | null | undefined,
  owned: SearchVenue[] | null | undefined,
  limit = 6,
): DiscoverVenue[] {
  const seen = new Set<string>((owned ?? []).map((v) => v.id));
  const out: DiscoverVenue[] = [];
  for (const v of discover ?? []) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
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
