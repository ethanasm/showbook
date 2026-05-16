"use client";

import { trpc } from "@/lib/trpc";
import "./show-tabs.css";

interface PrimingStatProps {
  showId: string;
  /**
   * When true, render a slimmer line (used by the header strip on
   * narrow viewports). No-op visually right now but kept as a hook
   * for future iteration.
   */
  compact?: boolean;
}

/**
 * Phase 7 — italic "you'd primed X of Y played" line in the show title
 * block. Reads from `shows.spotify_prep_track_count`, which the nightly
 * recently-played cron populates. Renders nothing when the feature is
 * disabled, when the show hasn't yet been settled (job runs 6h
 * post-show), or when the user isn't connected.
 */
export function PrimingStat({ showId, compact = false }: PrimingStatProps) {
  const query = trpc.setlistIntel.primingStat.useQuery(
    { showId },
    { staleTime: 5 * 60_000 },
  );
  if (query.isLoading || !query.data) return null;
  const { prepCount } = query.data;
  if (prepCount == null || prepCount <= 0) return null;
  return (
    <span
      className={`priming-stat${compact ? " priming-stat--compact" : ""}`}
      data-testid="priming-stat"
    >
      You&rsquo;d primed {prepCount} track{prepCount === 1 ? "" : "s"} in the run-up
    </span>
  );
}
