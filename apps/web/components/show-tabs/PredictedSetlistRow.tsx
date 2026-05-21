"use client";

import Link from "next/link";
import { Tooltip } from "../design-system/Tooltip";
import { TrackPreview } from "./TrackPreview";
import "./show-tabs.css";

interface PredictedSetlistRowProps {
  position: number;
  title: string;
  evidence: string;
  /** Place a 24px disabled slot for the Phase-9 TrackPreview button. */
  showPreviewSlot?: boolean;
  /** Optional inline badges, rendered to the right of the row. Each is
   *  wrapped in a <Tooltip> so the explanatory text shows on hover
   *  AND on tap (the bare HTML `title=` attribute doesn't show on
   *  mobile). Scope is encoded in the label itself: every user-scoped
   *  badge uses "you/your"; the artist-scoped 💎 Rare doesn't, so the
   *  two scopes can't be confused. */
  badge?: {
    firstTime: boolean;
    rareCatch: { fractionPct: number } | null;
    /** Phase 11 §15j — 💛 song saved in user's Spotify library. */
    saved?: boolean;
    /** Phase 11 §15j — 🎯 user has never heard this song live before. */
    personalFirstTime?: boolean;
    /** Phase 11 §15j — ⭐ song is in user's Spotify long-term top 50. */
    topTrack?: boolean;
  };
  /** Phase 2: when set, the title becomes a link to /songs/[songId]. */
  songId?: string | null;
  /**
   * Phase 9 — when set, render the real `<TrackPreview>` button in the
   * 24px slot. Requires `showId` so the button can call
   * `setlistIntel.resolveTrackPreview` on lazy resolve. When absent,
   * the slot stays empty.
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
  const previewsOn = !!showId;
  // Badge tooltips. Disambiguation goal: every personal (user-scoped)
  // label uses "you/your". The artist-scoped 💎 Rare tooltip
  // deliberately omits "you" so the scope is obvious from wording.
  const firstTimeLabel = "The show where you first heard this live";
  const rareLabel = badge?.rareCatch
    ? `Played in ${badge.rareCatch.fractionPct}% of recent setlists`
    : null;
  const savedLabel = "Saved in your Spotify library";
  const personalFirstTimeLabel = "You've never heard this live";
  const topTrackLabel = "In your Spotify long-term top 50";
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
        {evidence && (
          <div className="predicted-row__evidence">{evidence}</div>
        )}
      </div>
      <div className="predicted-row__badges">
        {badge?.firstTime && (
          <Tooltip label={firstTimeLabel}>
            <span
              className="predicted-row__badge predicted-row__badge--first-time"
              data-testid="predicted-row-badge-first-time"
              aria-label={firstTimeLabel}
            >
              🆕 Your first
            </span>
          </Tooltip>
        )}
        {badge?.rareCatch && rareLabel && (
          <Tooltip label={rareLabel}>
            <span
              className="predicted-row__badge predicted-row__badge--rare"
              data-testid="predicted-row-badge-rare"
              aria-label={rareLabel}
            >
              💎 Rare ({badge.rareCatch.fractionPct}%)
            </span>
          </Tooltip>
        )}
        {badge?.saved && (
          <Tooltip label={savedLabel}>
            <span
              className="predicted-row__badge predicted-row__badge--saved"
              data-testid="predicted-row-badge-saved"
              aria-label={savedLabel}
            >
              💛 Your library
            </span>
          </Tooltip>
        )}
        {badge?.personalFirstTime && (
          <Tooltip label={personalFirstTimeLabel}>
            <span
              className="predicted-row__badge predicted-row__badge--personal-first-time"
              data-testid="predicted-row-badge-personal-first-time"
              aria-label={personalFirstTimeLabel}
            >
              🎯 New to you
            </span>
          </Tooltip>
        )}
        {badge?.topTrack && (
          <Tooltip label={topTrackLabel}>
            <span
              className="predicted-row__badge predicted-row__badge--top-track"
              data-testid="predicted-row-badge-top-track"
              aria-label={topTrackLabel}
            >
              ⭐ Your top 50
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
