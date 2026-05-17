"use client";

import Link from "next/link";
import { isFeatureOn } from "@showbook/shared";
import { TrackPreview } from "./TrackPreview";
import "./show-tabs.css";

interface PredictedSetlistRowProps {
  position: number;
  title: string;
  evidence: string;
  /** Place a 24px disabled slot for the Phase-9 TrackPreview button. */
  showPreviewSlot?: boolean;
  /** Phase 2: optional inline badges. When present, render the 🆕 / 🎯
   *  chips on the right of the row and (if `songId` is provided) make
   *  the title tap through to the song detail page. */
  badge?: {
    firstTime: boolean;
    rareCatch: { fractionPct: number } | null;
  };
  /** Phase 2: when set, the title becomes a link to /songs/[songId]. */
  songId?: string | null;
  /**
   * Phase 9 — when set, render the real `<TrackPreview>` button in the
   * 24px slot. Requires `showId` so the button can call
   * `setlistIntel.resolveTrackPreview` on lazy resolve. When the
   * `SetlistIntelPreviews` flag is OFF, the slot stays empty.
   */
  showId?: string;
  /** Phase 9 — cached preview URL from `trackPreviewsForShow`. */
  previewUrl?: string | null;
  /** Phase 9 — cached Spotify track id from `trackPreviewsForShow`. */
  spotifyTrackId?: string | null;
}

/**
 * Single row in the predicted (or actual) setlist body. Designed to
 * collapse cleanly when the preview slot is hidden — Phase 1 reserves
 * the slot so Phase 9 can drop in the `TrackPreview` button without
 * shifting any layout.
 */
export function PredictedSetlistRow({
  position,
  title,
  evidence,
  showPreviewSlot = true,
  badge,
  songId,
  showId,
  previewUrl,
  spotifyTrackId,
}: PredictedSetlistRowProps) {
  const previewsOn = isFeatureOn("SetlistIntelPreviews") && !!showId;
  const firstTimeLabel = "First time you heard this song live";
  const rareLabel = badge?.rareCatch
    ? `Played in ${badge.rareCatch.fractionPct}% of recent setlists`
    : null;
  const titleNode = (
    <div className="predicted-row__title" data-testid="predicted-row-title">
      {title}
    </div>
  );
  return (
    <div className="predicted-row" data-testid="predicted-setlist-row">
      <span className="predicted-row__pos">
        {String(position).padStart(2, "0")}
      </span>
      {showPreviewSlot ? (
        previewsOn ? (
          <TrackPreview
            showId={showId as string}
            title={title}
            previewUrl={previewUrl ?? null}
            spotifyTrackId={spotifyTrackId ?? null}
          />
        ) : (
          <div
            className="predicted-row__preview-slot"
            aria-hidden="true"
            data-testid="predicted-row-preview-slot"
          />
        )
      ) : (
        <span />
      )}
      <div style={{ minWidth: 0 }}>
        {songId ? (
          <Link
            href={`/songs/${songId}`}
            className="predicted-row__title-link"
            data-testid="predicted-row-title-link"
          >
            {titleNode}
          </Link>
        ) : (
          titleNode
        )}
        <div className="predicted-row__evidence">
          {evidence}
          {badge?.firstTime && (
            <span
              className="predicted-row__badge predicted-row__badge--first-time"
              data-testid="predicted-row-badge-first-time"
              title={firstTimeLabel}
              aria-label={firstTimeLabel}
            >
              🆕 First time
            </span>
          )}
          {badge?.rareCatch && rareLabel && (
            <span
              className="predicted-row__badge predicted-row__badge--rare"
              data-testid="predicted-row-badge-rare"
              title={rareLabel}
              aria-label={rareLabel}
            >
              🎯 Rare ({badge.rareCatch.fractionPct}%)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
