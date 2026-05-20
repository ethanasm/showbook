// Headliner / support accessors for showPerformers. Pure logic lives
// in `@showbook/shared`'s show-accessors so it can be imported in
// both server (api) and client (web) contexts without dragging
// pg-boss / drizzle through. This file re-exports the shared bits
// and adds the web-only `getHeadlinerImageUrl` accessor that routes
// through the self-healing `/api/show-cover/<id>` proxy.

import {
  getHeadliner,
  getHeadlinerId,
  getSupportPerformers,
  hasProductionLabel,
  isProductionShow,
  pickHeadliner,
  type ShowLike,
  type ShowPerformerLike,
} from '@showbook/shared';

import type { ActualSong } from '../components/show-tabs/SetlistTab';

export {
  getHeadliner,
  getHeadlinerId,
  getSupportPerformers,
  hasProductionLabel,
  isProductionShow,
  pickHeadliner,
};
export type { ShowLike, ShowPerformerLike };

/**
 * Web-only headliner image accessor. Theatre productions AND festivals
 * with a productionName route through `/api/show-cover/<id>` so the
 * cover lazy-resolves on first request (matches the
 * `/api/performer-photo/<id>` pattern). Stays in the web app because
 * it returns a route-relative URL.
 */
export function getHeadlinerImageUrl(show: ShowLike): string | null {
  if (hasProductionLabel(show)) {
    return show.id
      ? `/api/show-cover/${show.id}`
      : (show.coverImageUrl ?? null);
  }
  return (
    pickHeadliner(show)?.performer.imageUrl ?? show.coverImageUrl ?? null
  );
}

/**
 * Display labels for support performers — sorted, names only. Distinct
 * from `getSupportPerformers` (which returns ids) because most call
 * sites only want the names.
 */
export function getSupport(show: ShowLike): string[] {
  return getSupportPerformers(show).map((p) => p.name);
}

type SetlistSongInput = { title: string; note?: string | null };
type SetlistSectionInput = {
  kind?: string;
  songs: SetlistSongInput[];
};
type PerformerSetlistInput = { sections: SetlistSectionInput[] };

/**
 * Flatten a performer's nested setlist (sections → songs) into a flat
 * `ActualSong[]` with section/song indices preserved, encore flags
 * derived from `section.kind === 'encore'`, and opener/closer markers
 * computed for non-encore sections. Pure — extracted from
 * `ShowDetailTabsView` so the festival branch's per-performer
 * mapping and the headliner branch's single mapping share one
 * deterministic implementation that can be unit-tested.
 */
export function buildActualSongsFromSetlist(
  setlist: PerformerSetlistInput | null | undefined,
): ActualSong[] {
  if (!setlist) return [];
  const out: ActualSong[] = [];
  setlist.sections.forEach((section, sIdx) => {
    const isEncore = section.kind === 'encore';
    section.songs.forEach((song, songIdx) => {
      out.push({
        title: song.title,
        sectionIndex: sIdx,
        songIndex: songIdx,
        isEncore,
        isOpenerOrCloser:
          (!isEncore && sIdx === 0 && songIdx === 0) ||
          (!isEncore && songIdx === section.songs.length - 1),
        note: song.note ?? null,
      });
    });
  });
  return out;
}
