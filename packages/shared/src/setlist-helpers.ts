/**
 * Pure setlist + lineup helpers shared by web and mobile show-detail
 * surfaces. Lifted out of `apps/web/lib/show-accessors.ts` so the
 * mobile `ShowDetailTabsView` no longer carries an inline copy of the
 * setlist-flatten / festival-lineup logic.
 *
 * Web's `apps/web/lib/show-accessors.ts` still owns the web-only
 * `getHeadlinerImageUrl` accessor (it routes through the
 * `/api/show-cover/<id>` proxy) and re-exports everything from here
 * for existing call sites.
 */

import { getSupportPerformers, type ShowLike } from './show-accessors';

export interface ActualSong {
  title: string;
  sectionIndex: number;
  songIndex: number;
  isEncore: boolean;
  isOpenerOrCloser?: boolean;
  note?: string | null;
}

type SetlistSongInput = { title: string; note?: string | null };
type SetlistSectionInput = {
  kind?: string;
  songs: SetlistSongInput[];
};
type PerformerSetlistInput = { sections: SetlistSectionInput[] };

/**
 * Display labels for support performers — sorted, names only. Distinct
 * from `getSupportPerformers` (which returns ids) because most call
 * sites only want the names.
 */
export function getSupport(show: ShowLike): string[] {
  return getSupportPerformers(show).map((p) => p.name);
}

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

type FestivalLineupBuilderShowPerformer = {
  role: string;
  sortOrder: number;
  performer: { id: string; name: string };
};

type FestivalLineupBuilderEntry<P> = {
  performerId: string;
  performerName: string;
  role: 'headliner' | 'support';
  sortOrder: number;
  prediction: P | null;
  actualSongs: ActualSong[];
};

/**
 * Build the per-performer lineup row set the festival Setlist tab
 * renders. Pure — `ShowDetailTabsView` wraps this in a `useMemo` and
 * supplies React-side inputs (the predictedFestivalSetlists query
 * data + the per-performer setlists map). Extracting here keeps the
 * filter / sort / actualSongs fan-out coverable without a component
 * mount.
 */
export function buildFestivalLineupEntries<P>(opts: {
  showPerformers: FestivalLineupBuilderShowPerformer[];
  isPast: boolean;
  predictions: Array<{ performerId: string; prediction: P }> | null;
  setlistsByPerformer: Record<string, PerformerSetlistInput | null | undefined>;
}): FestivalLineupBuilderEntry<P>[] {
  const predictionsByPerformer = new Map<string, P>();
  if (!opts.isPast && opts.predictions) {
    for (const e of opts.predictions) {
      predictionsByPerformer.set(e.performerId, e.prediction);
    }
  }
  return opts.showPerformers
    .filter((sp) => sp.role === 'headliner' || sp.role === 'support')
    .map((sp) => ({
      performerId: sp.performer.id,
      performerName: sp.performer.name,
      role: sp.role as 'headliner' | 'support',
      sortOrder: sp.sortOrder,
      prediction: predictionsByPerformer.get(sp.performer.id) ?? null,
      actualSongs: opts.isPast
        ? buildActualSongsFromSetlist(opts.setlistsByPerformer[sp.performer.id])
        : [],
    }));
}

/**
 * Sum the actualSongs counts across a festival lineup. Returns 0
 * unless the show is both `isFestival` and `isPast`. Pure — used by
 * the show-detail header strip to surface the total played-songs
 * count for past festivals.
 */
export function countFestivalActualSongs(opts: {
  isFestival: boolean;
  isPast: boolean;
  entries: Array<{ actualSongs: ActualSong[] }>;
}): number {
  if (!(opts.isFestival && opts.isPast)) return 0;
  return opts.entries.reduce((acc, e) => acc + e.actualSongs.length, 0);
}
