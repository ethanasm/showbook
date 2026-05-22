"use client";

import { useCallback, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  SpotifyConnectModal,
  useSpotifyConnection,
} from "@/components/spotify";
import "./show-tabs.css";

interface HypePlaylistCardProps {
  showId: string;
  /** Performer whose songs the playlist is built from. The festival
   *  Setlist tab passes the chip-rail selection so each lineup
   *  artist gets its own playlist row; single-artist concerts pass
   *  the headliner. */
  performerId: string;
  artist: string;
  /** 'hype' (pre-show, predicted) or 'heard' (post-show, actual). */
  kind: "hype" | "heard";
  /** Track count we expect to surface; drives the headline copy. */
  trackCount: number;
  /** Approximate runtime in minutes; null when we can't estimate. */
  approxMinutes: number | null;
  /** When true, renders a tighter padding for the right-rail variant. */
  compact?: boolean;
}

interface PlaylistRow {
  playlistId: string;
  spotifyUrl: string;
  trackCount: number;
  durationMs: number;
}

/**
 * Phase 3 hype/heard playlist hero. Replaces the P1 placeholder. The
 * shape is identical for both `kind`s — only the headline text and
 * the mutation called on click differ.
 *
 * UX:
 *   - First tap on a fresh account → connect modal → OAuth (popup) →
 *     mutation auto-fires once the connection lands → toast.
 *   - Subsequent taps after the row exists → "Open in Spotify" link,
 *     opens existing playlist in a new tab.
 *   - Errors are surfaced as inline status text under the buttons.
 */
export function HypePlaylistCard({
  showId,
  performerId,
  artist,
  kind,
  trackCount,
  approxMinutes,
  compact = false,
}: HypePlaylistCardProps) {
  const existingQuery = trpc.spotify.existingPlaylist.useQuery({
    showId,
    kind,
    performerId,
  });
  const utils = trpc.useUtils();

  const createHype = trpc.spotify.createHypePlaylist.useMutation({
    onSuccess: () => {
      void utils.spotify.existingPlaylist.invalidate({ showId, kind, performerId });
    },
  });
  const createHeard = trpc.spotify.createHeardPlaylist.useMutation({
    onSuccess: () => {
      void utils.spotify.existingPlaylist.invalidate({ showId, kind, performerId });
    },
  });

  const { requireConnection, modalOpen, closeModal, startConnect, error: connectError } =
    useSpotifyConnection();

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [scopeMissing, setScopeMissing] = useState<string[]>([]);

  const existing: PlaylistRow | null = existingQuery.data ?? null;
  const isCreating = createHype.isPending || createHeard.isPending;
  const createKindLabel = kind === "hype" ? "Hype playlist" : "I Heard";

  const headline =
    kind === "hype"
      ? `Spin up ${trackCount} song${trackCount === 1 ? "" : "s"} you'll hear`
      : `Save ${trackCount} song${trackCount === 1 ? "" : "s"} to Spotify`;

  const sub = useMemo(() => {
    if (approxMinutes != null) {
      return kind === "hype"
        ? `~${approxMinutes} min · ordered like the show · drops onto your Spotify`
        : `~${approxMinutes} min · in show order · drops onto your Spotify`;
    }
    return kind === "hype"
      ? "Ordered like the show · drops onto your Spotify"
      : "In show order · drops onto your Spotify";
  }, [approxMinutes, kind]);

  const coverWord = artist.toLowerCase().split(" ")[0] ?? "hype";

  const handleCreate = useCallback(async () => {
    setStatusMsg(null);
    setScopeMissing([]);
    try {
      if (kind === "hype") {
        const result = await createHype.mutateAsync({ showId, performerId });
        if (result.missing.length > 0) {
          setStatusMsg(
            `Created — ${result.trackCount} of ${result.requested} resolved`,
          );
        } else {
          setStatusMsg(
            `Created — ${result.trackCount} song${result.trackCount === 1 ? "" : "s"} on Spotify`,
          );
        }
      } else {
        const result = await createHeard.mutateAsync({ showId, performerId });
        setStatusMsg(
          result.missing.length > 0
            ? `Created — ${result.trackCount} of ${result.requested} resolved`
            : `Created — ${result.trackCount} song${result.trackCount === 1 ? "" : "s"} on Spotify`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      const scopePrefix = "spotify_scopes_missing:";
      if (msg.includes(scopePrefix)) {
        const missing = msg
          .slice(msg.indexOf(scopePrefix) + scopePrefix.length)
          .split(",")
          .filter(Boolean);
        setScopeMissing(missing);
        setStatusMsg(
          "Spotify needs an updated permission. Reconnect to continue.",
        );
        return;
      }
      if (msg.includes("spotify_not_connected")) {
        setStatusMsg("Connect Spotify to create this playlist.");
        return;
      }
      if (msg.includes("prediction_cold") || msg.includes("prediction_empty")) {
        setStatusMsg("Not enough setlist data yet — try again closer to the show.");
        return;
      }
      if (msg.includes("setlist_empty")) {
        setStatusMsg("No setlist on file yet — add songs from the Edit panel.");
        return;
      }
      setStatusMsg("Spotify export failed. Try again in a moment.");
    }
  }, [kind, createHype, createHeard, showId, performerId]);

  const handleOpenClick = useCallback(async () => {
    if (existing) {
      window.open(existing.spotifyUrl, "_blank", "noopener,noreferrer");
      return;
    }
    await requireConnection(handleCreate);
  }, [existing, handleCreate, requireConnection]);

  const ctaLabel = existing ? "Open in Spotify" : isCreating ? "Working…" : "Open in Spotify";

  // The "Preview here" button is a secondary affordance — inline 30s
  // previews ship on each setlist row via `<TrackPreview>` (Phase 9),
  // so this card-level button is a no-op placeholder kept for layout
  // parity with the design handoff.
  return (
    <>
      <div
        className="hype-card"
        data-testid={`hype-playlist-card-${kind}`}
        data-existing={existing ? "true" : "false"}
        style={compact ? { padding: 14 } : undefined}
      >
        <div className="hype-card__cover" aria-hidden="true">
          <div className="hype-card__brand">SHOWBOOK</div>
          <div className="hype-card__cover-title">
            {kind === "hype" ? "hype" : "heard"}
            <br />
            {coverWord}
          </div>
          <div className="hype-card__bar" />
        </div>
        <div className="hype-card__body">
          <div>
            <div className="hype-card__headline">{headline}</div>
            <div className="hype-card__sub">{sub}</div>
          </div>
          <div className="hype-card__buttons">
            <button
              type="button"
              className="hype-card__cta hype-card__cta--active"
              onClick={() => void handleOpenClick()}
              disabled={isCreating}
              data-testid={`hype-card-${kind}-primary`}
              aria-label={
                existing
                  ? `Open ${createKindLabel} on Spotify`
                  : `Create ${createKindLabel} on Spotify`
              }
            >
              <SpotifyGlyph size={12} /> {ctaLabel}
            </button>
            <button
              type="button"
              className="hype-card__cta-secondary"
              disabled
              title="Preview each track inline via the ▶ button on the setlist rows below."
            >
              Preview here
            </button>
          </div>
          {(statusMsg || isCreating || scopeMissing.length > 0) && (
            <div
              data-testid={`hype-card-${kind}-status`}
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10,
                color: scopeMissing.length > 0 ? "#E63946" : "var(--muted)",
                letterSpacing: ".02em",
                marginTop: 6,
              }}
            >
              {isCreating ? "Building playlist on Spotify…" : statusMsg}
            </div>
          )}
        </div>
      </div>
      <SpotifyConnectModal
        open={modalOpen}
        ctaLabel={
          kind === "hype"
            ? "Connect to make a hype playlist for tonight's show."
            : `Connect to save tonight's setlist to Spotify.`
        }
        error={connectError}
        onConnect={startConnect}
        onClose={closeModal}
      />
    </>
  );
}

function SpotifyGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="7.5"
        fill="currentColor"
        fillOpacity="0.001"
        stroke="currentColor"
        strokeOpacity=".25"
      />
      <path
        d="M3.6 6.4 c2.4-.8 6.4-.6 8.8.8 M4 8.4 c2-.6 5.4-.4 7.4.8 M4.4 10.4 c1.8-.5 4.4-.3 6 .6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
