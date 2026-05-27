// Ticketmaster Discovery API client
// https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/

import { child } from '@showbook/observability';

const log = child({ component: 'api.ticketmaster', provider: 'ticketmaster' });

const BASE_URL = "https://app.ticketmaster.com/discovery/v2";
function getApiKey(): string | undefined {
  return process.env.TICKETMASTER_API_KEY;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TMImage {
  ratio: string;
  url: string;
  width: number;
  height: number;
  fallback: boolean;
}

export interface TMVenue {
  id: string;
  name: string;
  postalCode?: string;
  timezone?: string;
  city?: { name: string };
  state?: { name: string; stateCode: string };
  country?: { name: string; countryCode: string };
  address?: { line1: string };
  location?: { longitude: string; latitude: string };
  images?: TMImage[];
}

export interface TMAttraction {
  id: string;
  name: string;
  url?: string;
  externalLinks?: {
    musicbrainz?: Array<{ id: string }>;
    spotify?: Array<{ url: string }>;
  };
  images?: TMImage[];
  classifications?: Array<{
    primary?: boolean;
    segment?: { name: string };
    genre?: { name: string };
    subGenre?: { name: string };
    type?: { name: string };
    subType?: { name: string };
  }>;
  upcomingEvents?: Record<string, number>;
}

export interface TMEvent {
  id: string;
  name: string;
  url?: string;
  images?: TMImage[];
  dates: {
    start: {
      localDate: string;
      localTime?: string;
      dateTime?: string;
    };
    status?: { code: string };
  };
  sales?: {
    public?: {
      startDateTime?: string;
      endDateTime?: string;
    };
    presales?: Array<{
      name?: string;
      startDateTime?: string;
      endDateTime?: string;
      url?: string;
      description?: string;
    }>;
  };
  classifications?: Array<{
    primary?: boolean;
    segment?: { id: string; name: string };
    genre?: { id: string; name: string };
    subGenre?: { id: string; name: string };
    type?: { id: string; name: string };
    subType?: { id: string; name: string };
  }>;
  _embedded?: {
    venues?: TMVenue[];
    attractions?: TMAttraction[];
  };
}

interface TMPageResponse<T> {
  _embedded?: { events?: T[]; venues?: T[]; attractions?: T[] };
  page: {
    size: number;
    totalElements: number;
    totalPages: number;
    number: number;
  };
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class TMError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
    this.name = "TMError";
  }
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 200; // 5 req/sec

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_INTERVAL_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_INTERVAL_MS - timeSinceLastRequest),
    );
  }
  lastRequestTime = Date.now();

  const startedAt = Date.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const durationMs = Date.now() - startedAt;
  if (response.status === 429) {
    log.warn({ event: 'tm.request.rate_limited', durationMs }, 'Ticketmaster 429, retrying');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return rateLimitedFetch(url);
  }
  if (!response.ok) {
    log.warn({ event: 'tm.request.error', status: response.status, durationMs }, 'Ticketmaster non-OK response');
  } else {
    log.debug({ event: 'tm.request.ok', status: response.status, durationMs }, 'Ticketmaster request');
  }
  return response;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let warnedNoKey = false;
function isApiKeyMissing(): boolean {
  const key = getApiKey();
  if (key && key.length > 0) return false;
  if (!warnedNoKey) {
    warnedNoKey = true;
    log.warn(
      { event: 'tm.request.skipped_no_key' },
      'TICKETMASTER_API_KEY not set; Ticketmaster calls will return empty results',
    );
  }
  return true;
}

function buildUrl(path: string, params: Record<string, string | undefined>): string {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("apikey", getApiKey() ?? "");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function tmFetch<T>(url: string): Promise<T> {
  const response = await rateLimitedFetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new TMError(
      `Ticketmaster API error: ${response.status}`,
      response.status,
      body,
    );
  }
  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function searchEvents(params: {
  keyword?: string;
  venueId?: string;
  attractionId?: string;
  latlong?: string;
  radius?: number;
  unit?: string;
  startDateTime?: string;
  endDateTime?: string;
  classificationName?: string;
  size?: number;
  page?: number;
}): Promise<{ events: TMEvent[]; totalElements: number; totalPages: number }> {
  if (isApiKeyMissing()) return { events: [], totalElements: 0, totalPages: 0 };
  const url = buildUrl("/events.json", {
    keyword: params.keyword,
    venueId: params.venueId,
    attractionId: params.attractionId,
    latlong: params.latlong,
    radius: params.radius?.toString(),
    unit: params.unit,
    startDateTime: params.startDateTime,
    endDateTime: params.endDateTime,
    classificationName: params.classificationName,
    size: params.size?.toString(),
    page: params.page?.toString(),
  });

  const data = await tmFetch<TMPageResponse<TMEvent>>(url);
  return {
    events: data._embedded?.events ?? [],
    totalElements: data.page.totalElements,
    totalPages: data.page.totalPages,
  };
}

export async function getVenue(tmVenueId: string): Promise<TMVenue | null> {
  if (isApiKeyMissing()) return null;
  try {
    const url = buildUrl(`/venues/${encodeURIComponent(tmVenueId)}.json`, {});
    return await tmFetch<TMVenue>(url);
  } catch (err) {
    if (err instanceof TMError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function getEvent(tmEventId: string): Promise<TMEvent | null> {
  if (isApiKeyMissing()) return null;
  try {
    const url = buildUrl(`/events/${encodeURIComponent(tmEventId)}.json`, {});
    return await tmFetch<TMEvent>(url);
  } catch (err) {
    if (err instanceof TMError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function getAttraction(
  tmAttractionId: string,
): Promise<TMAttraction | null> {
  if (isApiKeyMissing()) return null;
  try {
    const url = buildUrl(`/attractions/${encodeURIComponent(tmAttractionId)}.json`, {});
    return await tmFetch<TMAttraction>(url);
  } catch (err) {
    if (err instanceof TMError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function searchVenues(params: {
  keyword: string;
  stateCode?: string;
  countryCode?: string;
  size?: number;
}): Promise<TMVenue[]> {
  if (isApiKeyMissing()) return [];
  const url = buildUrl("/venues.json", {
    keyword: params.keyword,
    stateCode: params.stateCode,
    countryCode: params.countryCode,
    size: (params.size ?? 5).toString(),
  });
  const data = await tmFetch<TMPageResponse<TMVenue>>(url);
  return data._embedded?.venues ?? [];
}

export async function searchAttractions(
  keyword: string,
): Promise<TMAttraction[]> {
  if (isApiKeyMissing()) return [];
  const url = buildUrl("/attractions.json", { keyword });
  const data = await tmFetch<TMPageResponse<TMAttraction>>(url);
  return data._embedded?.attractions ?? [];
}

// ---------------------------------------------------------------------------
// Pure helpers (no network)
// ---------------------------------------------------------------------------

export function normalizeFestivalText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Pull a stable festival name out of a TM event name like
 * `"Outside Lands 2026 - Friday Single Day"` → `"Outside Lands"`. Used to
 * give every event in a multi-day festival the same `headliner` so the
 * existing `groupEventsIntoRuns` cluster key collapses them into one run,
 * regardless of which artist tops the per-day bill.
 *
 * Strategy: take the prefix before the first separator (`-`, `–`, `|`),
 * strip year tokens (`2026`, `'26`) and day-of-week tokens, then iteratively
 * peel trailing festival-noise tokens (`Festival`, `Music & Arts`, etc.) so
 * TM's three names for Outside Lands — `"Outside Lands"`,
 * `"Outside Lands Festival - FRIDAY Platinum"`, and
 * `"Outside Lands Music & Arts Festival"` — all canonicalize to the same
 * `"Outside Lands"` cluster key. Falls back to the original string when
 * stripping leaves nothing usable.
 */
export function extractFestivalName(eventName: string): string {
  // Split on the separator alone and trim each side, rather than baking
  // `\s*` into the separator regex — `\s*[-–|]\s*` is polynomial-ReDoS-
  // ambiguous on inputs full of whitespace and no separator.
  const prefix = eventName.split(/[-–|]/)[0]?.trim() ?? eventName;
  let stripped = prefix
    .replace(/\b(20\d{2}|'\d{2})\b/g, "")
    .replace(/\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  // Strip a trailing "[Music & Arts | Music | Arts] Festival" / "Fest" tail
  // in one match so the engine doesn't pick the shortest leftmost
  // alternative ("Arts Festival" inside "Music & Arts Festival") and leave
  // the qualifier behind. The optional inner group eats the qualifier word
  // when present, then `festival` / `fest` anchors the end.
  const TRAILING_NOISE =
    /\s+(?:music\s*(?:&|and)\s*arts\s+|music\s+|arts\s+)?(?:festival|fest)$/i;
  const next = stripped.replace(TRAILING_NOISE, "").trim();
  if (next.length > 0) stripped = next;
  return stripped.length > 0 ? stripped : eventName.trim();
}

function hasFestivalSignal(value: string): boolean {
  const normalized = normalizeFestivalText(value);
  return normalized.includes("festival") || /\bfest\b/.test(normalized);
}

// Stable Ticketmaster classification IDs. These are the public, documented
// segment + genre identifiers — they appear in TM's own URLs (e.g.
// ticketmaster.com/discover/...?categoryId=KZFzniwnSyZfZ7v7na) and don't
// change over time. We key off these instead of segment/genre *names*
// because TM is inconsistent about the human-readable label on individual
// events (a Broadway tour like Phantom of the Opera might come back with
// genre "Theatrical Production" or "Performance Art" rather than the
// literal substring "theatre"/"musical"), which used to cause Arts & Theatre
// events to fall through to the "concert" default.
const TM_SEGMENT_ID = {
  music: "KZFzniwnSyZfZ7v7nJ",
  sports: "KZFzniwnSyZfZ7v7nE",
  artsTheatre: "KZFzniwnSyZfZ7v7na",
  film: "KZFzniwnSyZfZ7v7nn",
  miscellaneous: "KZFzniwnSyZfZ7v7n1",
} as const;

// Comedy genre under the Arts & Theatre segment. Every other Arts & Theatre
// genre (Theatre, Musical, Children's Theatre, Dance, Opera, Magic & Illusion,
// Performance Art, Cultural, Variety, Fine Art, Multimedia, Circus & Specialty
// Acts, Lectures & Seminars, Pre-Game Shows) is a stage performance and maps
// to "theatre".
const TM_GENRE_ID_COMEDY = "KnvZfZ7vAe1";

export type InferredKind =
  | "concert"
  | "theatre"
  | "comedy"
  | "festival"
  | "sports"
  | "film"
  | "unknown";

// Known festival names that TM consistently mis-segments. Outside Lands, for
// example, comes back with no music classification at all (its events landed
// in the "unknown" bucket alongside parking-pass / suite-deposit listings).
// Kept tiny and explicit so it's not a substring trap; expand only when we
// confirm a festival is being miscategorised in prod.
const KNOWN_FESTIVAL_NAMES = ["outside lands"];

function matchesKnownFestivalName(eventName: string): boolean {
  const normalized = normalizeFestivalText(eventName);
  return KNOWN_FESTIVAL_NAMES.some((name) => normalized.includes(name));
}

export function inferKind(
  classifications?: TMEvent["classifications"],
  context?: { eventName?: string | null },
): InferredKind {
  const eventName = context?.eventName ?? "";

  // Festival detection runs FIRST and is name-driven, not segment-gated. TM
  // is wildly inconsistent about how festivals are classified — Outside Lands
  // 2026 comes back with no music segment at all (events landed in the
  // miscellaneous "unknown" bucket pre-fix). Pulling the festival check ahead
  // of the segment switch means a festival name (or genre/subGenre/type label
  // that says "Festival") wins regardless of what TM tagged the segment as.
  const labelText = (classifications ?? [])
    .flatMap((c) => [c.genre?.name, c.subGenre?.name, c.type?.name, c.subType?.name])
    .filter((name): name is string => Boolean(name))
    .join(" ");
  if (hasFestivalSignal(`${labelText} ${eventName}`)) {
    return "festival";
  }
  if (matchesKnownFestivalName(eventName)) {
    return "festival";
  }

  // No classifications at all means TM didn't tell us what kind of event
  // this is. We don't want to silently bucket those as concerts (that's how
  // the Orpheum theatre productions ended up mislabelled), so flag them as
  // "unknown" and let a human / admin sort them out.
  if (!classifications || classifications.length === 0) return "unknown";

  const primary =
    classifications.find((c) => c.primary) ?? classifications[0];
  const segmentId = primary?.segment?.id;

  if (segmentId === TM_SEGMENT_ID.sports) {
    return "sports";
  }

  if (segmentId === TM_SEGMENT_ID.film) {
    return "film";
  }

  if (segmentId === TM_SEGMENT_ID.artsTheatre) {
    const isComedy = classifications.some(
      (c) => c.genre?.id === TM_GENRE_ID_COMEDY,
    );
    return isComedy ? "comedy" : "theatre";
  }

  if (segmentId === TM_SEGMENT_ID.music) {
    return "concert";
  }

  // Miscellaneous segment, or a segment ID we don't recognise. Don't
  // pretend we know — surface as "unknown" so it's visible on Discover but
  // can't accidentally be added to a watchlist.
  return "unknown";
}

export function extractMusicbrainzId(attraction: TMAttraction): string | undefined {
  return attraction.externalLinks?.musicbrainz?.[0]?.id;
}

/**
 * TM's Discovery API returns two events for a given physical show when both
 * primary box-office tickets and resale-marketplace listings exist: a
 * primary event whose `url` has the form
 * `https://www.ticketmaster.com/<slug>/event/<id>`, and a resale event
 * whose `url` is the bare `https://www.ticketmaster.com/event/<id>`.
 * The bare-format URL renders "Page Not Found" on ticketmaster.com — it's
 * only meaningful inside the resale flow. Filter to primary URLs before
 * persisting as `ticket_url`.
 */
export function isPrimaryEventUrl(
  url: string | null | undefined,
): url is string {
  if (!url) return false;
  return /:\/\/[^/]+\/[^/]+\/event\//.test(url);
}

/**
 * Walk a TM event list and return the URL of the first event whose `url`
 * is a primary (slug-format) Ticketmaster link. Returns null when no
 * candidate qualifies — callers should leave `ticket_url` null rather
 * than store the resale-marketplace fallback.
 */
export function pickPrimaryEventUrl(
  events: ReadonlyArray<{ url?: string }>,
): string | null {
  for (const e of events) {
    if (isPrimaryEventUrl(e.url)) return e.url;
  }
  return null;
}

export function selectBestImage(images?: TMImage[]): string | null {
  if (!images || images.length === 0) return null;

  const valid = images.filter((img) => !img.fallback);
  if (valid.length === 0) return null;

  // Prefer 3_2 ratio, then largest width
  const preferred = valid.filter((img) => img.ratio === "3_2");
  const pool = preferred.length > 0 ? preferred : valid;

  pool.sort((a, b) => b.width - a.width);
  return pool[0].url;
}

/**
 * Pick the best usable image across a candidate list of TM attractions
 * for a given productionName. Walks the list twice:
 *
 *   1. Exact (case-insensitive, trimmed) name matches whose `images[]`
 *      yields a usable URL via `selectBestImage`.
 *   2. `"<name> (<suffix>)"` variants — TM frequently leaves the bare
 *      record without promo art and maintains the region/year-suffixed
 *      record (e.g. `"Cabaret at the Kit Kat Club"` is image-less while
 *      `"Cabaret at the Kit Kat Club (NY)"` carries the real poster).
 *      The trailing-`)` check prevents `"Cabaret Extreme"` from sneaking
 *      in just because its name starts with `"Cabaret"`.
 *
 * Returns null if no candidate yields a usable image — the caller logs
 * `show.cover.no_match` and the row stays uncovered until the next pass.
 */
export function pickAttractionImage(
  candidates: TMAttraction[],
  productionName: string,
): string | null {
  const target = productionName.trim().toLowerCase();
  if (!target) return null;

  for (const a of candidates) {
    if (a.name.trim().toLowerCase() !== target) continue;
    const url = selectBestImage(a.images);
    if (url) return url;
  }

  const suffixPrefix = `${target} (`;
  for (const a of candidates) {
    const n = a.name.trim().toLowerCase();
    if (!n.startsWith(suffixPrefix) || !n.endsWith(')')) continue;
    const url = selectBestImage(a.images);
    if (url) return url;
  }

  return null;
}
