// Pure accessors for picking the headliner / support out of a show's
// showPerformers join. Multiple page-local copies existed before this; the
// home page's copy used `sortOrder === 1` while every other call site used
// `sortOrder === 0` (the canonical insert path in shows.create), so home
// was silently picking the wrong row when sortOrder happened to start at 0.
// This consolidation fixes that — `sortOrder === 0` wins everywhere.

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
  kind?: string;
  productionName?: string | null;
  showPerformers: ShowPerformerLike[];
}

function pickHeadliner(show: ShowLike): ShowPerformerLike | undefined {
  return (
    show.showPerformers.find(
      (sp) => sp.role === "headliner" && sp.sortOrder === 0,
    ) ??
    show.showPerformers.find((sp) => sp.role === "headliner") ??
    show.showPerformers[0]
  );
}

function isProductionShow(show: ShowLike): boolean {
  return (
    (show.kind === "theatre" || show.kind === "festival") &&
    Boolean(show.productionName)
  );
}

export function getHeadliner(show: ShowLike): string {
  if (isProductionShow(show)) return show.productionName!;
  return pickHeadliner(show)?.performer.name ?? "Unknown Artist";
}

export function getHeadlinerId(show: ShowLike): string | undefined {
  if (isProductionShow(show)) return undefined;
  return pickHeadliner(show)?.performer.id;
}

export function getHeadlinerImageUrl(show: ShowLike): string | null {
  if (isProductionShow(show)) return null;
  return pickHeadliner(show)?.performer.imageUrl ?? null;
}

export function getSupport(show: ShowLike): string[] {
  return show.showPerformers
    .filter((sp) => sp.role === "support")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sp) => sp.performer.name);
}

export function getSupportPerformers(
  show: ShowLike,
): { id: string; name: string }[] {
  return show.showPerformers
    .filter((sp) => sp.role === "support")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sp) => ({ id: sp.performer.id, name: sp.performer.name }));
}
