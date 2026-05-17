/**
 * Multi-night-run detector for rotating-style artists. §15e of the
 * feature plan.
 *
 * For a target (performer, date), look back through the last 7 days of
 * corpus rows for *consecutive* dates at the same venue. When such a
 * run exists, the rotating prediction excludes the songs played on
 * those nights from the "likely" pool and the UI surfaces the run via
 * `<MultiNightContextBanner>`.
 *
 * Pure — accepts the corpus rows the caller already loaded and a
 * resolved venue match. No DB access.
 *
 * Spec: showbook-specs/setlist-intelligence/phases/phase-05-style-classifier-rotating.md
 */

import type { PerformerSetlist } from '@showbook/shared';
import type { CorpusRow } from './setlist-predict';

const MS_PER_DAY = 86_400_000;
const RUN_LOOKBACK_DAYS = 7;

export interface RunContext {
  /** Same-venue label (raw venue name; some corpus rows lack a refId). */
  venue: string;
  /** Number of consecutive prior nights detected at this venue. */
  priorNights: number;
  /** Total run length so far including tonight (priorNights + 1). */
  runIndex: number;
  /** Distinct song titles already played in the run (lower-cased keys
   *  in the underlying set; preserved-case in the array). */
  songsAlreadyPlayed: string[];
  /** Earliest performance date in the consecutive run. */
  runStartDate: string;
}

/**
 * Walk a list of (performance_date, venue) tuples and identify the
 * consecutive prior-night chain leading up to `targetDate` at the same
 * venue. Returns `null` when no chain is found within `RUN_LOOKBACK_DAYS`.
 *
 * "Same venue" prefers an exact match on the resolved venue name; the
 * caller can do a fuzzy pre-pass when a corpus row lacks a clean venue
 * ref. We don't lower-case the venue name here — corpus rows come from
 * setlist.fm with stable casing.
 */
export function detectMultiNightRun(opts: {
  targetDate: string;
  targetVenue?: string | null;
  corpus: CorpusRow[];
  /** Pull the venue name from a corpus row. Surface this so the caller
   *  can plumb in a resolved-venue accessor for fuzzier matching. */
  venueOf?: (row: CorpusRow) => string | null;
}): RunContext | null {
  if (!opts.targetVenue) return null;
  const venueOf = opts.venueOf ?? defaultVenueOf;

  const targetTs = new Date(opts.targetDate).getTime();
  if (Number.isNaN(targetTs)) return null;

  // Build a date-keyed map of corpus rows played at the target venue
  // within the lookback window. Only same-venue + earlier-than-target.
  const byDate = new Map<string, CorpusRow>();
  const lowerLimit = targetTs - RUN_LOOKBACK_DAYS * MS_PER_DAY;
  for (const row of opts.corpus) {
    const ts = new Date(row.performanceDate).getTime();
    if (Number.isNaN(ts) || ts >= targetTs || ts < lowerLimit) continue;
    const venue = venueOf(row);
    if (!venue || venue !== opts.targetVenue) continue;
    byDate.set(row.performanceDate, row);
  }
  if (byDate.size === 0) return null;

  // Walk backwards day-by-day from (targetDate - 1) looking for an
  // unbroken consecutive chain.
  const nights: CorpusRow[] = [];
  let cursor = targetTs - MS_PER_DAY;
  while (cursor >= lowerLimit) {
    const dateStr = new Date(cursor).toISOString().slice(0, 10);
    const hit = byDate.get(dateStr);
    if (!hit) break;
    nights.push(hit);
    cursor -= MS_PER_DAY;
  }
  if (nights.length === 0) return null;

  const songsLower = new Set<string>();
  const songs: string[] = [];
  for (const row of nights) {
    for (const title of titlesOf(row.setlist)) {
      const lower = title.trim().toLowerCase();
      if (lower.length === 0 || songsLower.has(lower)) continue;
      songsLower.add(lower);
      songs.push(title);
    }
  }
  const runStartDate = nights[nights.length - 1]!.performanceDate;

  return {
    venue: opts.targetVenue,
    priorNights: nights.length,
    runIndex: nights.length + 1,
    songsAlreadyPlayed: songs,
    runStartDate,
  };
}

function titlesOf(setlist: PerformerSetlist): string[] {
  const out: string[] = [];
  for (const section of setlist.sections) {
    for (const song of section.songs) out.push(song.title);
  }
  return out;
}

/** Default venue accessor — pulls the raw venue name the corpus loader
 *  hydrates from `tour_setlists.venue_name_raw`. Callers can supply a
 *  custom `venueOf` to plug in a fuzzier match (city-suffix strip,
 *  diacritics normalize, venue-alias table). */
function defaultVenueOf(row: CorpusRow): string | null {
  return row.venueNameRaw ?? null;
}
