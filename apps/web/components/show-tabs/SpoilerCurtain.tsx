"use client";

import "./show-tabs.css";

interface SpoilerCurtainProps {
  artistName: string;
  onReveal: () => void;
  onOpenSettings: () => void;
}

/**
 * Spoiler curtain — default-on for stable-style predicted setlists per
 * `ui-spec.md` §3.8. The "Show structure only" CTA is deferred from
 * Phase 1; Phase 5 lands the structure-only mode alongside the
 * rotating-style variant where it has the most value (Phish-shaped
 * jam-band setlists benefit more from positional structure than
 * stable pop tours).
 */
export function SpoilerCurtain({
  artistName,
  onReveal,
  onOpenSettings,
}: SpoilerCurtainProps) {
  return (
    <div className="spoiler-curtain" data-testid="spoiler-curtain">
      <div className="spoiler-curtain__title">Spoiler-blur on</div>
      <div className="spoiler-curtain__body">
        We hide stable-style setlists by default so the moment of
        recognition still lands at the show. Tap to see {artistName}
        &rsquo;s likely lineup.
      </div>
      <button
        type="button"
        className="spoiler-curtain__primary"
        data-testid="spoiler-curtain-reveal"
        onClick={onReveal}
      >
        Show me the show
      </button>
      <button
        type="button"
        className="spoiler-curtain__settings"
        onClick={onOpenSettings}
      >
        Spoiler settings &rarr;
      </button>
    </div>
  );
}
