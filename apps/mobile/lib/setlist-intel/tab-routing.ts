/**
 * Phase 10 (mobile parity) — pure tab-routing helpers for the 4-tab
 * show-detail layout. Mirrors `apps/web/components/show-tabs/types.ts`
 * but lives in `apps/mobile/lib/` so it sits inside the mobile coverage
 * gate and can be exercised without React Native.
 *
 * The tab order is fixed across pre/post show so muscle memory survives
 * the lifecycle transition — only the badge content changes. See
 * `showbook-specs/setlist-intelligence/show-page-redesign-2026-05-16.md`
 * for the canonical contract.
 */

export type ShowTabKey = 'overview' | 'setlist' | 'media' | 'notes';

export const SHOW_TAB_KEYS: readonly ShowTabKey[] = [
  'overview',
  'setlist',
  'media',
  'notes',
] as const;

export function parseShowTab(value: string | null | undefined): ShowTabKey {
  if (!value) return 'overview';
  return (SHOW_TAB_KEYS as readonly string[]).includes(value)
    ? (value as ShowTabKey)
    : 'overview';
}

export interface ShowTabBadges {
  overview: null;
  setlist: string | null;
  media: string | null;
  notes: string | null;
}

/**
 * Compute the badge content for each tab in the mobile show-detail
 * shell. Matches the web `computeShowTabBadges` behaviour exactly so a
 * single shared expectation can be asserted on both surfaces.
 *
 * Rules:
 *  - Overview: always null.
 *  - Setlist pre-show: rounded `confidence` as a percentage, or null
 *    when the prediction is cold / loading.
 *  - Setlist post-show: actual song count when > 0, else null.
 *  - Media: photo count as a string (always present, "0" allowed).
 *  - Notes: "·" indicator when the trimmed notes body is non-empty.
 */
export function computeShowTabBadges(opts: {
  isPast: boolean;
  predictionConfidence: number | null;
  actualSongCount: number;
  mediaCount: number;
  notesTrimmedLength: number;
}): ShowTabBadges {
  let setlist: string | null;
  if (opts.isPast) {
    setlist = opts.actualSongCount > 0 ? String(opts.actualSongCount) : null;
  } else if (opts.predictionConfidence != null) {
    setlist = `${Math.round(opts.predictionConfidence * 100)}%`;
  } else {
    setlist = null;
  }

  const media = String(opts.mediaCount);
  const notes = opts.notesTrimmedLength > 0 ? '·' : null;

  return {
    overview: null,
    setlist,
    media,
    notes,
  };
}
