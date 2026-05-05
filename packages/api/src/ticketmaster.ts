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

function normalizeFestivalText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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

export function inferKind(
  classifications?: TMEvent["classifications"],
  context?: { eventName?: string | null },
): "concert" | "theatre" | "comedy" | "festival" | "sports" {
  if (!classifications || classifications.length === 0) return "concert";

  const primary =
    classifications.find((c) => c.primary) ?? classifications[0];
  const segmentId = primary?.segment?.id;

  if (segmentId === TM_SEGMENT_ID.sports) {
    return "sports";
  }

  if (segmentId === TM_SEGMENT_ID.artsTheatre) {
    const isComedy = classifications.some(
      (c) => c.genre?.id === TM_GENRE_ID_COMEDY,
    );
    return isComedy ? "comedy" : "theatre";
  }

  if (segmentId === TM_SEGMENT_ID.music) {
    // Festivals don't have a single canonical TM ID — TM tags them via
    // genre / subGenre / type / subType *names* (e.g. genre "Festival",
    // subGenre "Music Festival", type "Festival Pass"). Match those label
    // fields directly, since that's the structured signal TM provides; this
    // isn't name-guessing the kind, it's reading TM's own festival flag.
    const eventName = context?.eventName ?? "";
    const labelText = classifications
      .flatMap((c) => [c.genre?.name, c.subGenre?.name, c.type?.name, c.subType?.name])
      .filter((name): name is string => Boolean(name))
      .join(" ");
    if (hasFestivalSignal(`${labelText} ${eventName}`)) {
      return "festival";
    }
    const knownFestivalNames = ["outside lands"];
    const normalizedEventName = normalizeFestivalText(eventName);
    if (knownFestivalNames.some((name) => normalizedEventName.includes(name))) {
      return "festival";
    }
    return "concert";
  }

  return "concert";
}

export function extractMusicbrainzId(attraction: TMAttraction): string | undefined {
  return attraction.externalLinks?.musicbrainz?.[0]?.id;
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
