"use client";

import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";
import { SectionFrame } from "./SectionFrame";
import "./show-tabs.css";

interface DiscoveredRailProps {
  showId: string;
}

/**
 * Phase 7 — "songs you discovered live" rail. Lives on the Setlist tab
 * (past shows). The design handoff swapped the originally-spec'd
 * horizontal-scroll rail for a list-row layout — each row shows the
 * track, artist, year, the Phase-9 preview slot, and a save/saved
 * button.
 *
 * Rendering rules:
 *   - Spotify disconnected → don't render anything (the Overview tab's
 *     FanLoyaltyRing surfaces the connect CTA).
 *   - No resolved-to-Spotify songs → don't render anything.
 *   - All songs already saved → render a quiet "no discoveries" tile so
 *     the absence is intelligible.
 *   - Otherwise → list the unsaved subset with save buttons that flip
 *     to a "saved" state on success.
 */
export function DiscoveredRail({ showId }: DiscoveredRailProps) {
  const query = trpc.setlistIntel.discoveredLive.useQuery(
    { showId },
    { staleTime: 60_000 },
  );
  const utils = trpc.useUtils();

  const saveMutation = trpc.setlistIntel.saveDiscoveredSong.useMutation({
    onSuccess: () => {
      void utils.setlistIntel.discoveredLive.invalidate({ showId });
      void utils.setlistIntel.fanLoyalty.invalidate({ showId });
    },
  });

  const [optimisticallySaved, setOptimisticallySaved] = useState<Set<string>>(
    () => new Set(),
  );
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});

  const handleSave = useCallback(
    async (songId: string) => {
      setErrorMap((prev) => {
        const next = { ...prev };
        delete next[songId];
        return next;
      });
      setOptimisticallySaved((prev) => new Set(prev).add(songId));
      try {
        await saveMutation.mutateAsync({ songId });
      } catch (err) {
        setOptimisticallySaved((prev) => {
          const next = new Set(prev);
          next.delete(songId);
          return next;
        });
        const msg = err instanceof Error ? err.message : "Failed";
        setErrorMap((prev) => ({ ...prev, [songId]: msg }));
      }
    },
    [saveMutation],
  );

  if (query.isLoading) return null;
  if (!query.data || !query.data.connected || query.data.noData) return null;
  if (query.data.tracks.length === 0) return null;

  const unsaved = query.data.tracks.filter(
    (t) => !t.saved && !optimisticallySaved.has(t.songId),
  );
  const saved = query.data.tracks.filter(
    (t) => t.saved || optimisticallySaved.has(t.songId),
  );

  if (unsaved.length === 0) {
    return (
      <SectionFrame title="Songs you discovered live">
        <div className="discovered-rail__empty" data-testid="discovered-rail-empty">
          You walked in knowing every track we could match on Spotify.
          {saved.length > 0 && (
            <span className="discovered-rail__empty-sub">
              {" "}({saved.length} song{saved.length === 1 ? "" : "s"} already saved)
            </span>
          )}
        </div>
      </SectionFrame>
    );
  }

  return (
    <SectionFrame title="Songs you discovered live">
    <div className="discovered-rail" data-testid="discovered-rail">
      {unsaved.map((track) => {
        const isSaving = saveMutation.isPending && saveMutation.variables?.songId === track.songId;
        const errorMsg = errorMap[track.songId];
        return (
          <div
            key={track.songId}
            className="discovered-row"
            data-testid="discovered-row"
          >
            <span
              className="discovered-row__preview"
              aria-hidden="true"
              title="Inline preview ships in Phase 9"
            />
            <div className="discovered-row__title-block">
              <div className="discovered-row__title">{track.title}</div>
              <div className="discovered-row__meta">
                {track.artistName}
                {track.year ? ` · ${track.year}` : ""}
              </div>
              {errorMsg && (
                <div
                  className="discovered-row__error"
                  data-testid={`discovered-row-error-${track.songId}`}
                >
                  Couldn&rsquo;t save — try again
                </div>
              )}
            </div>
            <button
              type="button"
              className="discovered-row__save"
              onClick={() => void handleSave(track.songId)}
              disabled={isSaving}
              data-testid={`discovered-row-save-${track.songId}`}
              aria-label={`Save ${track.title} to your Spotify library`}
            >
              {isSaving ? "Saving…" : "+ save"}
            </button>
          </div>
        );
      })}
      {saved.length > 0 && (
        <div
          className="discovered-rail__footer"
          data-testid="discovered-rail-saved-summary"
        >
          {saved.length} song{saved.length === 1 ? "" : "s"} already in your library
        </div>
      )}
    </div>
    </SectionFrame>
  );
}
