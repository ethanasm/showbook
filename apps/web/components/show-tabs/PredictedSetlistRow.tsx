"use client";

import "./show-tabs.css";

interface PredictedSetlistRowProps {
  position: number;
  title: string;
  evidence: string;
  role: "opener" | "closer" | "encore_open" | "encore_close" | "core";
  /** Place a 24px disabled slot for the Phase-9 TrackPreview button. */
  showPreviewSlot?: boolean;
}

const STAR_ROLES = new Set<PredictedSetlistRowProps["role"]>([
  "opener",
  "closer",
  "encore_open",
  "encore_close",
]);

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
  role,
  showPreviewSlot = true,
}: PredictedSetlistRowProps) {
  return (
    <div className="predicted-row" data-testid="predicted-setlist-row">
      <span className="predicted-row__pos">
        {String(position).padStart(2, "0")}
      </span>
      {showPreviewSlot ? (
        <div
          className="predicted-row__preview-slot"
          aria-hidden="true"
          data-testid="predicted-row-preview-slot"
        />
      ) : (
        <span />
      )}
      <div style={{ minWidth: 0 }}>
        <div className="predicted-row__title" data-testid="predicted-row-title">
          {title}
        </div>
        <div className="predicted-row__evidence">{evidence}</div>
      </div>
      {STAR_ROLES.has(role) ? (
        <span className="predicted-row__star" data-testid="predicted-row-star">
          ★
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}
