"use client";

import "./show-tabs.css";

interface MusicLayerEmptyProps {
  /** Whether Spotify is connected for this user. */
  spotifyConnected: boolean;
  /** Which atom slot this placeholder represents. */
  variant: "vibe-radar" | "fan-loyalty";
}

/**
 * Empty-state placeholder for the music-layer atoms (VibeRadar /
 * FanLoyaltyRing). Phase 8 / Phase 7 ship the real atoms; until
 * then this renders a dashed-border card explaining what will fill
 * the slot. The copy adapts to whether the user has connected
 * Spotify yet — disconnected users get a "Connect to fill this in"
 * CTA, connected users get a "we'll fill this in once your show
 * lands" expectation-set.
 */
export function MusicLayerEmpty({
  spotifyConnected,
  variant,
}: MusicLayerEmptyProps) {
  const copy = variant === "vibe-radar"
    ? {
        title: "Vibe radar (coming in Phase 8)",
        body: spotifyConnected
          ? "Once Spotify's audio features cover this artist, we'll average a 7-axis vibe profile across the predicted setlist and show the shape here."
          : "Connect Spotify and we'll average a 7-axis vibe profile across the predicted setlist and show the shape here.",
      }
    : {
        title: "Fan loyalty (coming in Phase 7)",
        body: spotifyConnected
          ? "After the show we'll count how many of tonight's tracks were already in your library — and chart your trajectory across shows."
          : "Connect Spotify and after the show we'll count how many tracks were already in your library before walking in.",
      };

  return (
    <div
      className="rail-placeholder"
      data-testid={`music-layer-empty-${variant}`}
    >
      <div className="rail-placeholder__title">{copy.title}</div>
      <div>{copy.body}</div>
    </div>
  );
}
