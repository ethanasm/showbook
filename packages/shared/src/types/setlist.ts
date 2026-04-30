/**
 * Per-performer setlist shape.
 *
 * Stored as JSONB on `shows.setlists` keyed by performer ID:
 *   { [performerId]: PerformerSetlist }
 *
 * Sections preserve the encore boundary that setlist.fm exposes via its
 * per-set `encore` flag. Order is encoded by array position — there is no
 * separate `order` field (single source of truth: the array index).
 *
 * Constraint: at most one section may have `kind: 'encore'`. The encore is
 * always rendered as the last section; a setlist with no encore is just a
 * single `kind: 'set'` section.
 */
export interface SetlistSong {
  title: string;
  /** Free-form note: "extended intro", "Talk Talk cover", etc. */
  note?: string;
}

export interface SetlistSection {
  kind: 'set' | 'encore';
  /** Optional label override; UI defaults to "Main set" / "Encore". */
  name?: string;
  songs: SetlistSong[];
}

export interface PerformerSetlist {
  sections: SetlistSection[];
}

export type PerformerSetlistsMap = Record<string, PerformerSetlist>;

/**
 * Total song count across all sections.
 */
export function setlistTotalSongs(setlist: PerformerSetlist): number {
  let total = 0;
  for (const section of setlist.sections) total += section.songs.length;
  return total;
}

/**
 * Returns true when the setlist contains no songs (empty sections, or no
 * sections at all). Used for "treat as cleared" checks.
 */
export function isSetlistEmpty(setlist: PerformerSetlist | null | undefined): boolean {
  if (!setlist) return true;
  return setlistTotalSongs(setlist) === 0;
}

/**
 * Wrap a flat title array as a single main-set setlist. Used for the
 * "type one song per line" entry path on the Add page, and for the legacy
 * `setlist text[]` fallback.
 */
export function singleMainSet(titles: string[]): PerformerSetlist {
  return {
    sections: [
      {
        kind: 'set',
        songs: titles.map((title) => ({ title })),
      },
    ],
  };
}

/**
 * Flatten the sections to a single ordered list of titles. Used by display
 * fallbacks and by Add-page-style flat entry where encore metadata is lost.
 */
export function flattenSetlistTitles(setlist: PerformerSetlist): string[] {
  const out: string[] = [];
  for (const section of setlist.sections) {
    for (const song of section.songs) out.push(song.title);
  }
  return out;
}

/**
 * Coerce arbitrary persisted JSON into a `PerformerSetlist`. Tolerates the
 * legacy `string[]` shape (wraps it as a single main set) so callers that
 * read directly from the DB don't crash on un-migrated rows during a deploy.
 */
export function normalizePerformerSetlist(
  value: unknown,
): PerformerSetlist | null {
  if (value == null) return null;
  // Legacy: string[]
  if (Array.isArray(value)) {
    const titles = value.filter((v): v is string => typeof v === 'string');
    if (titles.length === 0) return null;
    return singleMainSet(titles);
  }
  if (typeof value !== 'object') return null;
  const candidate = value as { sections?: unknown };
  if (!Array.isArray(candidate.sections)) return null;
  const sections: SetlistSection[] = [];
  for (const raw of candidate.sections) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { kind?: unknown; name?: unknown; songs?: unknown };
    const kind: SetlistSection['kind'] =
      r.kind === 'encore' ? 'encore' : 'set';
    const name = typeof r.name === 'string' ? r.name : undefined;
    const songs: SetlistSong[] = [];
    if (Array.isArray(r.songs)) {
      for (const s of r.songs) {
        if (typeof s === 'string') {
          if (s.length > 0) songs.push({ title: s });
        } else if (s && typeof s === 'object') {
          const so = s as { title?: unknown; note?: unknown };
          if (typeof so.title === 'string' && so.title.length > 0) {
            songs.push({
              title: so.title,
              ...(typeof so.note === 'string' && so.note.length > 0
                ? { note: so.note }
                : {}),
            });
          }
        }
      }
    }
    sections.push({ kind, ...(name ? { name } : {}), songs });
  }
  if (sections.length === 0) return null;
  return { sections };
}

/**
 * Coerce a raw `shows.setlists` JSONB blob into the typed map shape.
 * Returns an empty object (never null) so call sites can iterate without a
 * null guard.
 */
export function normalizePerformerSetlistsMap(
  value: unknown,
): PerformerSetlistsMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const out: PerformerSetlistsMap = {};
  for (const [performerId, raw] of Object.entries(value as Record<string, unknown>)) {
    const setlist = normalizePerformerSetlist(raw);
    if (setlist) out[performerId] = setlist;
  }
  return out;
}
