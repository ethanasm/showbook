/**
 * Pure accessors for picking the headliner / support out of a show's
 * `showPerformers` join. Lives in `@showbook/shared` because both the
 * web client and the api server need them; routing through
 * `@showbook/api` (which transitively pulls pg-boss) would break web
 * client bundles.
 *
 * The 3-tier headliner fallback (sortOrder=0 headliner → any
 * headliner → first row) is the canonical resolution the rest of the
 * codebase already inlines in `routers/shows.ts`, `routers/media.ts`,
 * and `routers/search.ts`. Refactoring those call sites to use this
 * helper is a follow-up; for now this module is the new prescribed
 * entry point.
 *
 * Web display surfaces want `getHeadlinerImageUrl`, which is web-only
 * (it routes through `/api/show-cover/<id>`) and lives in
 * `apps/web/lib/show-accessors.ts` alongside a re-export of these.
 */

export interface ShowPerformerLike {
  role: string;
  sortOrder: number;
  performer: {
    id: string;
    name: string;
    imageUrl?: string | null;
  };
}

export interface ShowLike {
  id?: string;
  kind?: string;
  productionName?: string | null;
  coverImageUrl?: string | null;
  showPerformers: ShowPerformerLike[];
}

export function pickHeadliner(show: ShowLike): ShowPerformerLike | undefined {
  return (
    show.showPerformers.find(
      (sp) => sp.role === 'headliner' && sp.sortOrder === 0,
    ) ??
    show.showPerformers.find((sp) => sp.role === 'headliner') ??
    show.showPerformers[0]
  );
}

/**
 * "No setlist concept" gate. Theatre productions follow a script;
 * predictions and per-performer setlists don't apply. Festivals are
 * NOT production shows even when `productionName` is set ("Bottlerock"
 * is a label, but the festival still has a multi-artist lineup where
 * each artist has its own setlist) — for that display behavior see
 * `hasProductionLabel`.
 */
export function isProductionShow(show: ShowLike): boolean {
  return show.kind === 'theatre' && Boolean(show.productionName);
}

/**
 * "Display the productionName as the title and route the cover image
 * through the show-cover proxy" — covers theatre productions AND
 * festivals with a productionName. Distinct from `isProductionShow`,
 * which is the no-setlist gate (theatre-only).
 */
export function hasProductionLabel(show: ShowLike): boolean {
  return (
    (show.kind === 'theatre' || show.kind === 'festival') &&
    Boolean(show.productionName)
  );
}

/**
 * Display label for the show's headliner. Theatre productions AND
 * festivals with a productionName ("Bottlerock") use that name as the
 * title. For everything else, falls through the 3-tier headliner
 * fallback and returns the performer name.
 */
export function getHeadliner(show: ShowLike): string {
  if (hasProductionLabel(show)) return show.productionName!;
  return pickHeadliner(show)?.performer.name ?? 'Unknown Artist';
}

/**
 * The headliner's performer UUID — `undefined` only for theatre
 * productions (where no performer record is canonical). Festivals
 * return their headliner's id even when a `productionName` is set,
 * so per-performer prediction works for the festival headliner.
 */
export function getHeadlinerId(show: ShowLike): string | undefined {
  if (isProductionShow(show)) return undefined;
  return pickHeadliner(show)?.performer.id;
}

export function getSupportPerformers(
  show: ShowLike,
): { id: string; name: string }[] {
  return show.showPerformers
    .filter((sp) => sp.role === 'support')
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sp) => ({ id: sp.performer.id, name: sp.performer.name }));
}
