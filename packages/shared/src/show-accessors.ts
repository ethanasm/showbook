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

export function isProductionShow(show: ShowLike): boolean {
  return (
    (show.kind === 'theatre' || show.kind === 'festival') &&
    Boolean(show.productionName)
  );
}

/**
 * Display label for the show's headliner. For theatre/festival rows
 * with a production name, that name is the label (no performer record
 * is canonical). For everything else, falls through the 3-tier
 * headliner fallback and returns the performer name.
 */
export function getHeadliner(show: ShowLike): string {
  if (isProductionShow(show)) return show.productionName!;
  return pickHeadliner(show)?.performer.name ?? 'Unknown Artist';
}

/**
 * The headliner's performer UUID — or `undefined` for production shows
 * (theatre/festival with a `productionName`, where no performer record
 * is the canonical "headliner"). Setlist-intelligence consumers that
 * need a `performerId` should defensively check for `undefined` and
 * route the request to the cold-empty-state branch when missing,
 * because a production show can't have a predicted setlist anyway.
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
