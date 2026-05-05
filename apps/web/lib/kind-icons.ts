import { Music, Clapperboard, Laugh, Tent, Trophy, Film, HelpCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { KIND_LABELS as SHARED_KIND_LABELS } from "@showbook/shared";

// Single source of truth for the {ShowKind → icon} mapping. Lucide is web-
// only, so this lives in apps/web/lib rather than packages/shared (which
// has no React/runtime deps).

export type ShowKindKey = "concert" | "theatre" | "comedy" | "festival";
export type DiscoverKindKey = ShowKindKey | "sports" | "film" | "unknown";

export const KIND_ICONS: Record<ShowKindKey, LucideIcon> = {
  concert: Music,
  theatre: Clapperboard,
  comedy: Laugh,
  festival: Tent,
};

export const DISCOVER_KIND_ICONS: Record<DiscoverKindKey, LucideIcon> = {
  ...KIND_ICONS,
  sports: Trophy,
  film: Film,
  unknown: HelpCircle,
};

// Re-export the canonical labels from @showbook/shared so a caller importing
// kind-icons gets icons + labels in one go.
export const KIND_LABELS: Record<DiscoverKindKey, string> = {
  concert: SHARED_KIND_LABELS.concert,
  theatre: SHARED_KIND_LABELS.theatre,
  comedy: SHARED_KIND_LABELS.comedy,
  festival: SHARED_KIND_LABELS.festival,
  sports: SHARED_KIND_LABELS.sports,
  film: SHARED_KIND_LABELS.film,
  unknown: SHARED_KIND_LABELS.unknown,
};
