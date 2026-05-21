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
  | 'cold'
  // Phase 11 §15g — special-event empty-state branch. The mobile
  // SetlistTab returns the SpecialEventCard short-circuit before
  // pickSetlistView is consulted, so this never gets routed to a
  // view; it's listed here so the type union compiles when the
  // server returns this style.
  | 'special_event';

export interface MinimalPrediction {
  style: PredictionStyle;
}

export type SetlistView =
  | 'loading'
  | 'cold'
  | 'stable'
  | 'rotating'
  | 'theatrical'
  | 'improvised';

/**
 * Decide which view to render in the Setlist tab pre-show. Mirrors the
 * web SetlistTabUpcoming switch:
 *  - loading: prediction not yet resolved
 *  - cold: server returned cold (`no_corpus`, `wrong_kind`, etc.)
 *  - stable: stable archetype — render predicted setlist with rows
 *  - rotating / theatrical / improvised: matching subtree
 *
 * Post-show always renders the actual setlist; this helper is only for
 * pre-show routing.
 */
export function pickSetlistView(
  prediction: MinimalPrediction | null,
): SetlistView {
  if (!prediction) return 'cold';
  switch (prediction.style) {
    case 'cold':
      return 'cold';
    case 'stable':
      return 'stable';
    case 'rotating':
      return 'rotating';
    case 'theatrical':
      return 'theatrical';
    case 'improvised':
      return 'improvised';
    case 'special_event':
      // The SetlistTab renders the SpecialEventCard before consulting
      // pickSetlistView, so this branch never fires in practice.
      // Returning 'cold' as a safe fallback keeps the type union
      // exhaustive for future refactors.
      return 'cold';
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
