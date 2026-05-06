// setlist.fm API client
// Docs: https://api.setlist.fm/docs/1.0/

import { child } from '@showbook/observability';
import type { PerformerSetlist, SetlistSection } from '@showbook/shared';

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
  /** Setlist organized into sections (main set + optional encore). */
  setlist: PerformerSetlist;
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
  // ISO date strings (YYYY-MM-DD) are zone-less calendar dates. Reformat
  // directly without going through `new Date`, which would parse them as
  // UTC midnight and shift the day in zones west of UTC.
  if (typeof date === "string") {
    const [y, m, d] = date.slice(0, 10).split("-");
    return `${d}-${m}-${y}`;
  }
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
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
    signal: AbortSignal.timeout(10_000),
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
      signal: AbortSignal.timeout(10_000),
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

  // Drop entries setlist.fm hasn't linked to MusicBrainz — their `mbid` is
  // empty/undefined, and any downstream `/search/setlists?artistMbid=` call
  // would 400.
  return data.artist
    .filter((a) => typeof a.mbid === 'string' && a.mbid.length > 0)
    .map((a) => ({
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

// ---------------------------------------------------------------------------
// User-attended import
// ---------------------------------------------------------------------------

export interface AttendedSetlist {
  setlistId: string;
  /** ISO YYYY-MM-DD (converted from setlist.fm's DD-MM-YYYY). */
  date: string;
  artist: { name: string; mbid: string };
  venue: { name: string; city?: string; state?: string; country?: string };
  tourName?: string;
  setlist: PerformerSetlist;
}

export interface AttendedPage {
  attended: AttendedSetlist[];
  total: number;
  page: number;
  itemsPerPage: number;
}

function fromSetlistFmDate(d: string): string {
  // setlist.fm returns DD-MM-YYYY; we store ISO YYYY-MM-DD on shows.
  const [day, month, year] = d.split('-');
  if (!day || !month || !year) return d;
  return `${year}-${month}-${day}`;
}

function mapSetlistToAttended(s: SetlistFmSetlist): AttendedSetlist | null {
  if (!s.artist?.mbid || !s.eventDate) return null;
  const mainSongs: SetlistSection['songs'] = [];
  const encoreSongs: SetlistSection['songs'] = [];
  for (const set of s.sets?.set ?? []) {
    const target = set.encore != null ? encoreSongs : mainSongs;
    for (const song of set.song ?? []) {
      if (!song.name) continue;
      target.push({
        title: song.name,
        ...(song.info ? { note: song.info } : {}),
      });
    }
  }
  const sections: SetlistSection[] = [];
  if (mainSongs.length > 0) sections.push({ kind: 'set', songs: mainSongs });
  if (encoreSongs.length > 0)
    sections.push({ kind: 'encore', songs: encoreSongs });

  return {
    setlistId: s.id,
    date: fromSetlistFmDate(s.eventDate),
    artist: { name: s.artist.name, mbid: s.artist.mbid },
    venue: {
      name: s.venue?.name ?? '',
      city: s.venue?.city?.name,
      state: s.venue?.city?.state,
      country: s.venue?.city?.country?.name,
    },
    tourName: s.tour?.name,
    setlist: { sections },
  };
}

/**
 * Fetch a page of a user's attended setlists. setlist.fm's `userId` URL
 * segment is the user's username. Returns an empty page on 404 (user not
 * found) so callers can surface an inline error rather than throwing.
 */
export async function getUserAttended(
  username: string,
  page = 1,
): Promise<AttendedPage> {
  const trimmed = username.trim();
  if (!trimmed) {
    return { attended: [], total: 0, page: 1, itemsPerPage: 0 };
  }
  const encoded = encodeURIComponent(trimmed);
  let data: SetlistSearchResponse;
  try {
    data = await apiFetch<SetlistSearchResponse>(
      `/user/${encoded}/attended?p=${page}`,
    );
  } catch (err) {
    if (err instanceof SetlistFmError && err.status === 404) {
      return { attended: [], total: 0, page, itemsPerPage: 0 };
    }
    throw err;
  }
  const attended: AttendedSetlist[] = [];
  for (const s of data.setlist ?? []) {
    const mapped = mapSetlistToAttended(s);
    if (mapped) attended.push(mapped);
  }
  return {
    attended,
    total: data.total ?? attended.length,
    page: data.page ?? page,
    itemsPerPage: data.itemsPerPage ?? attended.length,
  };
}

/**
 * Find a setlist for a given artist (by MusicBrainz ID) and date.
 * Returns null when no setlist is found.
 */
export async function searchSetlist(
  artistMbid: string,
  date: string | Date,
): Promise<SetlistResult | null> {
  // setlist.fm rejects an empty `artistMbid` query parameter with HTTP 400.
  // Fail closed at the boundary instead of building a malformed URL.
  if (!artistMbid) return null;
  const fmDate = toSetlistFmDate(date);
  const encoded = encodeURIComponent(artistMbid);

  let data: SetlistSearchResponse;
  try {
    data = await apiFetch<SetlistSearchResponse>(
      `/search/setlists?artistMbid=${encoded}&date=${fmDate}`,
    );
  } catch (err) {
    // 404 is the documented "no setlist for that artist+date" response. 400
    // is sometimes returned for the same case in practice (observed in prod
    // for valid artist+date combos on 2026-04-30); treat it the same so a
    // working artist match isn't lost just because there's no setlist.
    if (
      err instanceof SetlistFmError &&
      (err.status === 404 || err.status === 400)
    ) {
      return null;
    }
    throw err;
  }

  if (!data.setlist?.length) return null;

  const setlist = data.setlist[0]!;

  // Map each set to a section, preserving the encore boundary. setlist.fm
  // marks encores at the set level (`encore: 1` for the first encore, etc.);
  // we collapse all encore sets into a single `kind: 'encore'` section
  // because the product currently supports one encore per show.
  const mainSongs: SetlistSection['songs'] = [];
  const encoreSongs: SetlistSection['songs'] = [];
  for (const s of setlist.sets?.set ?? []) {
    const target = s.encore != null ? encoreSongs : mainSongs;
    for (const song of s.song ?? []) {
      if (!song.name || song.name.length === 0) continue;
      target.push({
        title: song.name,
        ...(song.info && song.info.length > 0 ? { note: song.info } : {}),
      });
    }
  }

  const sections: SetlistSection[] = [];
  if (mainSongs.length > 0) sections.push({ kind: 'set', songs: mainSongs });
  if (encoreSongs.length > 0)
    sections.push({ kind: 'encore', songs: encoreSongs });

  if (sections.length === 0) return null;

  return {
    setlist: { sections },
    tourName: setlist.tour?.name,
    setlistId: setlist.id,
  };
}
