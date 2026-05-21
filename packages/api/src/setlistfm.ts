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
// Rate limiter – simple sequential delay + process-wide 429 cooldown
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

// When setlist.fm returns 429 we set a cooldown so subsequent callers fail
// fast instead of each one queueing a fresh request that also 429s. Without
// this every pg-boss-driven consumer (corpus-fill, setlist-retry, mbid
// resolution) burns its retry budget against a single sustained rate-limit
// event — observed in prod 2026-05-21 as 875 enrichment/setlist-corpus-fill
// rows piling into `pgboss.job` over a 3h window after the daily quota
// tipped.
let cooldownUntilMs = 0;
const COOLDOWN_MS = 60_000;

/** Test-only hook: clears the cooldown state between cases. */
export function _resetRateLimitState(): void {
  lastRequestTime = 0;
  cooldownUntilMs = 0;
}

function isRateLimitedNow(): number {
  const now = Date.now();
  return cooldownUntilMs > now ? cooldownUntilMs - now : 0;
}

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

  const remainingCooldown = isRateLimitedNow();
  if (remainingCooldown > 0) {
    log.warn(
      { event: 'setlistfm.request.cooldown_skip', path, remainingMs: remainingCooldown },
      'setlist.fm in cooldown; skipping request',
    );
    throw new SetlistFmError(
      `setlist.fm in cooldown for ${remainingCooldown}ms`,
      429,
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
      if (retry.status === 429) {
        // Second 429 in a row → daily quota is genuinely gone. Open the
        // cooldown gate so further callers fail fast without consuming
        // pg-boss retry budget.
        cooldownUntilMs = Date.now() + COOLDOWN_MS;
        log.warn(
          { event: 'setlistfm.request.cooldown_opened', path, cooldownMs: COOLDOWN_MS },
          'setlist.fm cooldown opened',
        );
      }
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
  artist: { name: string; mbid: string | null };
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
  // For the attended-import flow we already have the setlist payload, so we
  // don't need an mbid to call back into setlist.fm. Only drop entries that
  // are missing the fields we genuinely can't recover (date + artist name).
  if (!s.eventDate || !s.artist?.name) return null;
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
    artist: { name: s.artist.name, mbid: s.artist.mbid ? s.artist.mbid : null },
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

// ---------------------------------------------------------------------------
// Per-artist paginated setlists (corpus fill for predicted setlists)
// ---------------------------------------------------------------------------

export interface ArtistSetlistEntry {
  /** setlist.fm setlist ID — used as the unique key in `tour_setlists`. */
  setlistfmId: string;
  /** ISO YYYY-MM-DD (converted from setlist.fm's DD-MM-YYYY). */
  performanceDate: string;
  artist: { name: string; mbid: string | null };
  venue: {
    name: string | null;
    city: string | null;
    countryCode: string | null;
  };
  /** Tour name as setlist.fm reports it. May be null/undefined for casual gigs. */
  tourName?: string;
  /** Setlist payload in our internal `PerformerSetlist` shape. */
  setlist: PerformerSetlist;
  /** Total song count across all sections. Denormalized for cheap weight calcs. */
  songCount: number;
}

function mapArtistSetlist(s: SetlistFmSetlist): ArtistSetlistEntry | null {
  if (!s.eventDate || !s.artist?.name) return null;
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
  if (sections.length === 0) return null;
  const songCount = mainSongs.length + encoreSongs.length;
  return {
    setlistfmId: s.id,
    performanceDate: fromSetlistFmDate(s.eventDate),
    artist: {
      name: s.artist.name,
      mbid: s.artist.mbid && s.artist.mbid.length > 0 ? s.artist.mbid : null,
    },
    venue: {
      name: s.venue?.name ?? null,
      city: s.venue?.city?.name ?? null,
      countryCode: s.venue?.city?.country?.code ?? null,
    },
    ...(s.tour?.name ? { tourName: s.tour.name } : {}),
    setlist: { sections },
    songCount,
  };
}

export interface FetchArtistSetlistsOptions {
  /**
   * Maximum number of pages to walk. Each page returns up to 20 setlists,
   * newest first. Caller picks the cap based on the corpus-fill mode:
   *   - `predict` mode: 3 pages (most recent ~60 setlists).
   *   - `deep`    mode: 10 pages (~200 setlists for the Songs page).
   *   - `refresh` mode: 1 page (daily cron).
   * Defaults to 3 to match the predict mode.
   */
  maxPages?: number;
  /**
   * Stop walking once a returned setlist's `eventDate` is older than this
   * ISO YYYY-MM-DD cutoff. Lets a `predict` corpus fill bail early once it
   * has covered the active leg without burning all 3 pages.
   */
  sinceDate?: string;
}

interface ArtistSetlistsResponse {
  setlist?: SetlistFmSetlist[];
  total?: number;
  page?: number;
  itemsPerPage?: number;
}

/**
 * Walk `GET /1.0/artist/{mbid}/setlists` paginated, newest first. Each
 * page yields up to 20 setlists. Returns mapped entries — empty (zero
 * songs) and malformed setlists are dropped so the caller can persist
 * directly without re-checking. Skips entries with `mbid` blank.
 *
 * Implementation rules:
 *   - One page = one HTTP request through the shared rate-limited
 *     `apiFetch` (sequential 500ms cadence + 429 retry — same as the
 *     rest of the client).
 *   - Stops after `maxPages` pages OR when the API returns an empty page
 *     OR when a setlist is older than `sinceDate` (whichever first).
 *   - Returns `[]` on 404 (mbid not in setlist.fm) — caller treats this
 *     as "cold corpus" rather than an error.
 */
export async function fetchArtistSetlists(
  artistMbid: string,
  opts: FetchArtistSetlistsOptions = {},
): Promise<ArtistSetlistEntry[]> {
  if (!artistMbid) return [];
  const maxPages = Math.max(1, opts.maxPages ?? 3);
  const sinceDate = opts.sinceDate ?? null;
  const encoded = encodeURIComponent(artistMbid);
  const out: ArtistSetlistEntry[] = [];

  for (let page = 1; page <= maxPages; page++) {
    let data: ArtistSetlistsResponse;
    try {
      data = await apiFetch<ArtistSetlistsResponse>(
        `/artist/${encoded}/setlists?p=${page}`,
      );
    } catch (err) {
      if (err instanceof SetlistFmError && err.status === 404) {
        log.debug(
          { event: 'setlistfm.artist_setlists.not_found', artistMbid, page },
          'setlist.fm returned 404 for artist setlists',
        );
        break;
      }
      throw err;
    }
    const items = data.setlist ?? [];
    if (items.length === 0) break;

    let stoppedEarly = false;
    for (const raw of items) {
      const mapped = mapArtistSetlist(raw);
      if (!mapped) continue;
      if (sinceDate && mapped.performanceDate < sinceDate) {
        stoppedEarly = true;
        break;
      }
      out.push(mapped);
    }
    if (stoppedEarly) break;
    if (items.length < 20) break;
  }

  log.info(
    {
      event: 'setlistfm.artist_setlists.fetched',
      artistMbid,
      pages: Math.min(maxPages, Math.ceil(out.length / 20) || 1),
      count: out.length,
    },
    'setlist.fm artist setlists fetched',
  );
  return out;
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
