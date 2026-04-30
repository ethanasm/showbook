// Ticketmaster Discovery API client
// https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/

import { child } from '@showbook/observability';

const log = child({ component: 'api.ticketmaster', provider: 'ticketmaster' });

const BASE_URL = "https://app.ticketmaster.com/discovery/v2";
const API_KEY = process.env.TICKETMASTER_API_KEY;

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

function buildUrl(path: string, params: Record<string, string | undefined>): string {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("apikey", API_KEY ?? "");
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
  try {
    const url = buildUrl(`/venues/${tmVenueId}.json`, {});
    return await tmFetch<TMVenue>(url);
  } catch (err) {
    if (err instanceof TMError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function getEvent(tmEventId: string): Promise<TMEvent | null> {
  try {
    const url = buildUrl(`/events/${tmEventId}.json`, {});
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
  try {
    const url = buildUrl(`/attractions/${tmAttractionId}.json`, {});
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

export function inferKind(
  classifications?: TMEvent["classifications"],
  context?: { eventName?: string | null },
): "concert" | "theatre" | "comedy" | "festival" | "sports" {
  if (!classifications || classifications.length === 0) return "concert";

  const primary =
    classifications.find((c) => c.primary) ?? classifications[0];
  const segmentName = primary?.segment?.name?.toLowerCase() ?? "";
  const genreName = primary?.genre?.name?.toLowerCase() ?? "";
  const eventName = context?.eventName?.toLowerCase() ?? "";

  if (segmentName.includes("sports")) {
    return "sports";
  }

  if (segmentName.includes("music")) {
    const classificationText = classifications
      .flatMap((classification) => [
        classification.genre?.name,
        classification.subGenre?.name,
        classification.type?.name,
        classification.subType?.name,
      ])
      .filter((name): name is string => Boolean(name))
      .join(" ")
      .toLowerCase();
    const festivalText = `${classificationText} ${eventName}`;
    const knownFestivalNames = ["outside lands"];

    if (hasFestivalSignal(festivalText)) {
      return "festival";
    }
    const normalizedEventName = normalizeFestivalText(eventName);
    if (knownFestivalNames.some((name) => normalizedEventName.includes(name))) {
      return "festival";
    }
    return "concert";
  }

  if (segmentName.includes("arts") || segmentName.includes("theatre")) {
    if (genreName.includes("comedy")) return "comedy";
    if (
      genreName.includes("musical") ||
      genreName.includes("theatre") ||
      genreName.includes("theater")
    ) {
      return "theatre";
    }
  }

  return "concert";
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
