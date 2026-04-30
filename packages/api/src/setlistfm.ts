// setlist.fm API client
// Docs: https://api.setlist.fm/docs/1.0/

import { child } from '@showbook/observability';

const log = child({ component: 'api.setlistfm', provider: 'setlistfm' });

const BASE_URL = "https://api.setlist.fm/rest/1.0";
const MIN_REQUEST_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Types – API response shapes
// ---------------------------------------------------------------------------

interface SetlistFmArtist {
  mbid: string;
  name: string;
  sortName: string;
  disambiguation?: string;
  url?: string;
}

interface SetlistFmSetlist {
  id: string;
  eventDate: string;
  artist: { mbid: string; name: string };
  venue: {
    id: string;
    name: string;
    city: {
      id: string;
      name: string;
      state?: string;
      stateCode?: string;
      coords?: { lat: number; long: number };
      country: { code: string; name: string };
    };
  };
  tour?: { name: string };
  sets: {
    set: Array<{
      encore?: number;
      song: Array<{ name: string; info?: string }>;
    }>;
  };
  url?: string;
}

// ---------------------------------------------------------------------------
// Types – Public result shapes
// ---------------------------------------------------------------------------

export interface SetlistResult {
  songs: string[];
  tourName?: string;
  setlistId: string;
}

export interface ArtistSearchResult {
  mbid: string;
  name: string;
  sortName: string;
  disambiguation?: string;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class SetlistFmError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "SetlistFmError";
  }
}

// ---------------------------------------------------------------------------
// Date helper
// ---------------------------------------------------------------------------

function toSetlistFmDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// ---------------------------------------------------------------------------
// Rate limiter – simple sequential delay
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed),
    );
  }
  lastRequestTime = Date.now();
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string): Promise<T> {
  const apiKey = process.env.SETLISTFM_API_KEY;
  if (!apiKey) {
    throw new SetlistFmError(
      "SETLISTFM_API_KEY environment variable is not set",
      0,
      path,
    );
  }

  await rateLimit();

  const url = `${BASE_URL}${path}`;
  const startedAt = Date.now();
  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  });
  log.debug({ event: 'setlistfm.request', path, status: res.status, durationMs: Date.now() - startedAt }, 'setlist.fm request');

  // 429 – retry once after a longer delay
  if (res.status === 429) {
    log.warn({ event: 'setlistfm.request.rate_limited', path }, 'setlist.fm 429, retrying');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    lastRequestTime = Date.now();
    const retry = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
    });
    if (!retry.ok) {
      throw new SetlistFmError(
        `setlist.fm ${retry.status}: ${retry.statusText}`,
        retry.status,
        path,
      );
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new SetlistFmError(
      `setlist.fm ${res.status}: ${res.statusText}`,
      res.status,
      path,
    );
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface ArtistSearchResponse {
  artist: SetlistFmArtist[];
  total: number;
  page: number;
  itemsPerPage: number;
}

/**
 * Search for an artist by name.
 * Returns an array of matching artists (caller picks the best match).
 */
export async function searchArtist(
  name: string,
): Promise<ArtistSearchResult[]> {
  const encoded = encodeURIComponent(name);

  let data: ArtistSearchResponse;
  try {
    data = await apiFetch<ArtistSearchResponse>(
      `/search/artists?artistName=${encoded}&sort=relevance`,
    );
  } catch (err) {
    if (err instanceof SetlistFmError && err.status === 404) {
      return [];
    }
    throw err;
  }

  if (!data.artist?.length) return [];

  return data.artist.map((a) => ({
    mbid: a.mbid,
    name: a.name,
    sortName: a.sortName,
    disambiguation: a.disambiguation,
  }));
}

interface SetlistSearchResponse {
  setlist: SetlistFmSetlist[];
  total: number;
  page: number;
  itemsPerPage: number;
}

/**
 * Find a setlist for a given artist (by MusicBrainz ID) and date.
 * Returns null when no setlist is found.
 */
export async function searchSetlist(
  artistMbid: string,
  date: string | Date,
): Promise<SetlistResult | null> {
  const fmDate = toSetlistFmDate(date);
  const encoded = encodeURIComponent(artistMbid);

  let data: SetlistSearchResponse;
  try {
    data = await apiFetch<SetlistSearchResponse>(
      `/search/setlists?artistMbid=${encoded}&date=${fmDate}`,
    );
  } catch (err) {
    if (err instanceof SetlistFmError && err.status === 404) {
      return null;
    }
    throw err;
  }

  if (!data.setlist?.length) return null;

  const setlist = data.setlist[0]!;

  // Flatten all songs across all sets (main + encores) in order
  const songs: string[] = (setlist.sets?.set ?? []).flatMap((s) =>
    (s.song ?? []).map((song) => song.name).filter((name) => name.length > 0),
  );

  return {
    songs,
    tourName: setlist.tour?.name,
    setlistId: setlist.id,
  };
}
