/**
 * Phase 10 — pure predicate for routing a `predictedSetlist` response
 * to the right mobile view. The web SetlistTab keeps the same switch
 * inline; pulling it out here lets the unit suite assert the routing
 * without rendering React Native.
 */

export type PredictionStyle =
  | 'stable'
  | 'rotating'
  | 'theatrical'
  | 'improvised'
  | 'cold';

export interface MinimalPrediction {
  style: PredictionStyle;
}

export type SetlistView =
  | 'loading'
  | 'cold'
  | 'stable'
  | 'rotating'
  | 'theatrical'
  | 'improvised'
  | 'rotating_blocked'
  | 'theatrical_blocked'
  | 'improvised_blocked';

export interface SetlistViewFlags {
  rotatingDisplayEnabled?: boolean;
  theatricalDisplayEnabled?: boolean;
  improvisedDisplayEnabled?: boolean;
}

/**
 * Decide which view to render in the Setlist tab pre-show. Mirrors the
 * web SetlistTabUpcoming switch:
 *  - loading: prediction not yet resolved
 *  - cold: server returned cold (`no_corpus`, `wrong_kind`, etc.)
 *  - stable: stable archetype — render predicted setlist with rows
 *  - rotating / theatrical / improvised: matching subtree, unless the
 *    matching display flag is OFF (then the *_blocked variant renders)
 *
 * Post-show always renders the actual setlist; this helper is only for
 * pre-show routing.
 */
export function pickSetlistView(
  prediction: MinimalPrediction | null,
  flags: SetlistViewFlags = {},
): SetlistView {
  if (!prediction) return 'cold';
  switch (prediction.style) {
    case 'cold':
      return 'cold';
    case 'stable':
      return 'stable';
    case 'rotating':
      return flags.rotatingDisplayEnabled ? 'rotating' : 'rotating_blocked';
    case 'theatrical':
      return flags.theatricalDisplayEnabled
        ? 'theatrical'
        : 'theatrical_blocked';
    case 'improvised':
      return flags.improvisedDisplayEnabled
        ? 'improvised'
        : 'improvised_blocked';
  }
}

/**
 * Per SI-05, the Hype/I-Heard playlist card hides for rotating and
 * improvised pre-show predictions — the model can't pick 25 specific
 * songs confidently, so a hype playlist would be low-relevance. Post-
 * show "I Heard" always renders (we know the actual setlist by then).
 *
 * Theatrical KEEPS the hype card pre-show — its deterministic setlist
 * is ordering-stable + hype-worthy.
 */
export function shouldRenderHypePlaylistCard(opts: {
  isPast: boolean;
  predictionStyle: PredictionStyle | null;
}): boolean {
  if (opts.isPast) return true;
  if (opts.predictionStyle == null) return false;
  if (opts.predictionStyle === 'rotating') return false;
  if (opts.predictionStyle === 'improvised') return false;
  if (opts.predictionStyle === 'cold') return false;
  return true;
}
