"use client";

/**
 * Festival show Setlist tab — chip rail across the lineup with the
 * per-artist Setlist content rendered below for the selected artist.
 * Mirrors the mobile FestivalSetlistTab; visual matches Discover's
 * chip rail but is responsive at all widths (the show-detail page
 * has no desktop sidebar).
 *
 * Each artist's prediction (upcoming) is loaded with
 * `prefer: 'festival'` server-side, so the corpus is filtered to
 * shorter sets (≤16 songs) when enough festival-shaped rows exist.
 * Past festivals expose per-performer setlists keyed by performerId
 * in `shows.setlists`, populated by the existing fan-out in
 * `shows-nightly` / `setlist-retry`.
 */

import { useEffect, useMemo, useState } from "react";
import { SetlistTab, type ActualSong } from "./SetlistTab";
import type {
  ColdPrediction,
  HotPrediction,
  ImprovisedPrediction,
  RotatingPrediction,
  TheatricalPrediction,
} from "@showbook/api";

export type AnyFestivalPrediction =
  | HotPrediction
  | ColdPrediction
  | RotatingPrediction
  | TheatricalPrediction
  | ImprovisedPrediction;

export interface FestivalLineupSetlistEntry {
  performerId: string;
  performerName: string;
  role: "headliner" | "support";
  sortOrder: number;
  prediction: AnyFestivalPrediction | null;
  actualSongs: ActualSong[];
}

interface FestivalSetlistTabProps {
  showId: string;
  isPast: boolean;
  entries: FestivalLineupSetlistEntry[];
  predictionsLoading: boolean;
  hypePlaylistEnabled?: boolean;
  badgePayload?: Parameters<typeof SetlistTab>[0]["badgePayload"];
  trackPreviews?: Parameters<typeof SetlistTab>[0]["trackPreviews"];
  onOpenSpoilerSettings?: () => void;
}

export function FestivalSetlistTab(
  props: FestivalSetlistTabProps,
): React.JSX.Element {
  const { entries, isPast } = props;

  // Sort headliner first (sortOrder 0), then supports by ascending
  // sortOrder. Keeps the chip rail order stable across re-renders.
  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        if (a.role !== b.role) return a.role === "headliner" ? -1 : 1;
        return a.sortOrder - b.sortOrder;
      }),
    [entries],
  );

  const defaultId = sortedEntries[0]?.performerId ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(defaultId);

  // Reset selection if the lineup changes and the current pick is gone.
  useEffect(() => {
    if (!selectedId) {
      setSelectedId(defaultId);
      return;
    }
    const stillPresent = sortedEntries.some(
      (e) => e.performerId === selectedId,
    );
    if (!stillPresent) setSelectedId(defaultId);
  }, [defaultId, selectedId, sortedEntries]);

  if (sortedEntries.length === 0) {
    return (
      <div
        data-testid="festival-setlist-tab-empty"
        className="festival-setlist-empty"
      >
        <p className="festival-setlist-empty__title">No lineup yet</p>
        <p className="festival-setlist-empty__body">
          Add artists to the lineup from the Overview tab and we&rsquo;ll
          pull each one&rsquo;s{" "}
          {isPast ? "setlist from the night" : "predicted setlist"} here.
        </p>
      </div>
    );
  }

  const selected =
    sortedEntries.find((e) => e.performerId === selectedId) ??
    sortedEntries[0];

  return (
    <div data-testid="festival-setlist-tab">
      <div
        className="festival-setlist-chips"
        data-testid="festival-setlist-chips"
      >
        {sortedEntries.map((entry) => {
          const isActive = entry.performerId === selected.performerId;
          const showCount = isPast && entry.actualSongs.length > 0;
          return (
            <button
              key={entry.performerId}
              type="button"
              className={`festival-setlist-chip${
                isActive ? " festival-setlist-chip--active" : ""
              }`}
              onClick={() => setSelectedId(entry.performerId)}
              data-testid={`festival-setlist-chip-${entry.performerId}`}
              aria-pressed={isActive}
            >
              <span className="festival-setlist-chip__label">
                {entry.performerName}
                {entry.role === "headliner" ? (
                  <span className="festival-setlist-chip__sublabel">
                    {" "}
                    · Headliner
                  </span>
                ) : null}
              </span>
              {showCount ? (
                <span className="festival-setlist-chip__count">
                  {entry.actualSongs.length}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <SetlistTab
        showId={props.showId}
        performerId={selected.performerId}
        isPast={isPast}
        artistName={selected.performerName}
        prediction={selected.prediction ?? null}
        predictionLoading={props.predictionsLoading}
        actualSongs={selected.actualSongs}
        hypePlaylistEnabled={props.hypePlaylistEnabled}
        badgePayload={props.badgePayload}
        trackPreviews={props.trackPreviews}
        onOpenSpoilerSettings={props.onOpenSpoilerSettings}
      />
    </div>
  );
}
