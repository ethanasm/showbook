// Headliner / support accessors for showPerformers, plus the pure
// setlist-flatten + festival-lineup helpers. The pure bits live in
// `@showbook/shared` so server (api) and the mobile app can import
// them without dragging pg-boss / drizzle through the web client.
// This file re-exports the shared surface and adds the web-only
// `getHeadlinerImageUrl` accessor that routes through the
// self-healing `/api/show-cover/<id>` proxy.

import {
  buildActualSongsFromSetlist,
  buildFestivalLineupEntries,
  countFestivalActualSongs,
  getHeadliner,
  getHeadlinerId,
  getSupport,
  getSupportPerformers,
  hasProductionLabel,
  isProductionShow,
  pickHeadliner,
  type ActualSong,
  type ShowLike,
  type ShowPerformerLike,
} from '@showbook/shared';

export {
  buildActualSongsFromSetlist,
  buildFestivalLineupEntries,
  countFestivalActualSongs,
  getHeadliner,
  getHeadlinerId,
  getSupport,
  getSupportPerformers,
  hasProductionLabel,
  isProductionShow,
  pickHeadliner,
};
export type { ActualSong, ShowLike, ShowPerformerLike };

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
