"use client";

import "./show-tabs.css";

/**
 * Tracked accent-gold "ENCORE" divider rendered inline inside the
 * Setlist tab between the main set and the encore songs. Grid-aware:
 * spans the full width of the 2-column predicted-setlist body.
 */
export function EncoreDivider() {
  return (
    <div className="encore-divider" data-testid="encore-divider">
      <div className="encore-divider__label">— Encore</div>
      <div className="encore-divider__rule" />
    </div>
  );
}
