/**
 * Shared types for the 4-tab show-page redesign (2026-05-16 handoff).
 *
 * The tab key set is closed: `overview` / `setlist` / `media` / `notes`.
 * URL state lives in `?tab=…`; missing or unknown values fall back to
 * `overview`. Order is fixed across pre/post show so muscle memory
 * survives the lifecycle transition — only the badge content changes.
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

/**
 * Badge content for each tab. The value is rendered inside the
 * mini-pill on the right of the tab label; `null` hides the pill.
 *
 * Sources (per show-page-redesign-2026-05-16.md):
 *   - Overview: always `null`.
 *   - Setlist pre-show: `'92%'` from `prediction.confidence`. Hidden
 *     in cold state.
 *   - Setlist post-show: song count, e.g. `'16'`.
 *   - Media: photo count, `'0'` allowed.
 *   - Notes: `'·'` when the notes column is non-empty, otherwise null.
 */
export interface ShowTabBadges {
  overview: null;
  setlist: string | null;
  media: string | null;
  notes: string | null;
}

/**
 * SI-05 — gate for the pre-show hype playlist. Hidden when the
 * prediction style can't anchor a 25-song high-confidence playlist
 * (`rotating`, `improvised`). Stable and theatrical predictions
 * pass through. Post-show shows always pass (the "I Heard" card is
 * sourced from the deterministic actual setlist, not the model).
 */
export function isHypePlaylistVisible(opts: {
  /** True when the show has already happened (state === 'past', or a
   *  ticketed show 3 h past its doors anchor — see effectiveShowState). */
  isPast: boolean;
  /** The prediction's style, or `'stable'` when the query is empty. */
  setlistStyle: string;
}): boolean {
  if (opts.isPast) return true;
  return opts.setlistStyle !== 'rotating' && opts.setlistStyle !== 'improvised';
}

export function computeShowTabBadges(opts: {
  isPast: boolean;
  /** Confidence ∈ [0,1] from the predicted-setlist procedure, or null. */
  predictionConfidence: number | null;
  /** Total songs across all sections of the actual setlist (post-show). */
  actualSongCount: number;
  /** Number of media assets associated with the show. */
  mediaCount: number;
  /** Length of the notes column after trim. */
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
