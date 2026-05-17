"use client";

import "./show-tabs.css";

interface HypePlaylistCardPlaceholderProps {
  artist: string;
  trackCount: number;
  approxMinutes?: number | null;
}

/**
 * Phase 1 placeholder for the Phase-3 `HypePlaylistCard`. Renders the
 * editorial shape (branded cover · headline · stat line · disabled
 * CTAs) so the Setlist-tab layout is visually correct from day one.
 * The CTAs are deliberately non-functional — clicking does nothing
 * and they carry `disabled` semantics until Phase 3 wires the real
 * playlist export to the Spotify API.
 */
export function HypePlaylistCardPlaceholder({
  artist,
  trackCount,
  approxMinutes,
}: HypePlaylistCardPlaceholderProps) {
  const coverTitle = artist.toLowerCase().split(" ")[0] ?? "hype";
  return (
    <div className="hype-card" data-testid="hype-playlist-placeholder">
      <div className="hype-card__cover" aria-hidden="true">
        <div className="hype-card__brand">SHOWBOOK</div>
        <div className="hype-card__cover-title">
          hype
          <br />
          {coverTitle}
        </div>
        <div className="hype-card__bar" />
      </div>
      <div className="hype-card__body">
        <div>
          <div className="hype-card__headline">
            Spin up {trackCount} songs you&rsquo;ll hear
          </div>
          <div className="hype-card__sub">
            {approxMinutes != null ? `~${approxMinutes} min · ` : ""}ordered
            like the show · drops onto your Spotify
          </div>
        </div>
        <div className="hype-card__buttons">
          <button
            type="button"
            className="hype-card__cta"
            disabled
            title="Coming in Phase 3 — Spotify export"
          >
            Open in Spotify
          </button>
          <button
            type="button"
            className="hype-card__cta-secondary"
            disabled
            title="Coming in Phase 3 — Spotify export"
          >
            Preview here
          </button>
        </div>
      </div>
    </div>
  );
}
