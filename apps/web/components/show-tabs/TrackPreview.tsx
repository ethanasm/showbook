"use client";

import { useCallback, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  usePreviewPlayer,
  type PreviewHandle,
} from "@/lib/preview-player";
import "./show-tabs.css";

/**
 * Phase 9 ▶ button — the 24px round play affordance that lives in the
 * third column of every setlist track row. Phase 1 shipped an empty
 * 24px slot at this exact position; this component slots straight
 * into it so the row's grid layout doesn't shift.
 *
 * States:
 *   - idle: ▶ glyph, ink color
 *   - active: animated waveform (mirrors the design handoff's
 *     `mlbar` keyframe at `music-layer.jsx:293`)
 *   - unavailable: muted ▶ with `cursor: not-allowed` + tooltip,
 *     fired whenever the resolver returns null preview AND we don't
 *     have a Premium driver wired
 *   - loading: muted ▶ with cursor: progress while
 *     `resolveTrackPreview` is in flight
 */

export interface TrackPreviewProps {
  /** Show id — used as the row's stable PreviewPlayer key. */
  showId: string;
  /** Row title — the search key for lazy resolution. */
  title: string;
  /** Cached preview URL when known, else null. */
  previewUrl: string | null;
  /** Cached Spotify track id when known, else null. */
  spotifyTrackId: string | null;
}

export function TrackPreview(props: TrackPreviewProps) {
  const player = usePreviewPlayer();
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<{
    previewUrl: string | null;
    spotifyTrackId: string | null;
  } | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const resolveMutation = trpc.setlistIntel.resolveTrackPreview.useMutation();

  const key = `${props.showId}:${props.title.toLowerCase()}`;
  const isActive = player.currentTrackKey === key;

  const handle = useMemo<PreviewHandle>(
    () => ({
      key,
      previewUrl: resolved?.previewUrl ?? props.previewUrl,
      spotifyTrackId: resolved?.spotifyTrackId ?? props.spotifyTrackId,
      label: props.title,
    }),
    [
      key,
      props.previewUrl,
      props.spotifyTrackId,
      props.title,
      resolved?.previewUrl,
      resolved?.spotifyTrackId,
    ],
  );

  // Tap. Either toggle the currently-playing row, or resolve + play
  // a new row. Lazy resolve only kicks in when both fields are null
  // (the catalog cache didn't pre-populate this title).
  const onClick = useCallback(async () => {
    if (unavailable) return;
    if (isActive) {
      player.stop();
      return;
    }
    if (handle.previewUrl || handle.spotifyTrackId) {
      await player.play(handle, () => setUnavailable(true));
      return;
    }
    // Lazy-resolve via tRPC, then attempt to play.
    setResolving(true);
    try {
      const next = await resolveMutation.mutateAsync({
        showId: props.showId,
        title: props.title,
      });
      setResolved(next);
      if (!next.previewUrl && !next.spotifyTrackId) {
        setUnavailable(true);
        return;
      }
      const resolvedHandle: PreviewHandle = {
        key,
        previewUrl: next.previewUrl,
        spotifyTrackId: next.spotifyTrackId,
        label: props.title,
      };
      await player.play(resolvedHandle, () => setUnavailable(true));
    } catch {
      // Resolver-side failure (no Spotify, rate-limit, fetch error) —
      // fall back to unavailable rather than throwing the row.
      setUnavailable(true);
    } finally {
      setResolving(false);
    }
  }, [
    handle,
    isActive,
    key,
    player,
    props.showId,
    props.title,
    resolveMutation,
    unavailable,
  ]);

  const disabled = unavailable || resolving;
  const title = unavailable
    ? "No preview available"
    : isActive
      ? "Stop"
      : resolving
        ? "Loading…"
        : "Play preview";

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled && !isActive}
      aria-label={title}
      title={title}
      data-testid="track-preview-button"
      data-active={isActive ? "true" : "false"}
      data-unavailable={unavailable ? "true" : "false"}
      className={`track-preview${isActive ? " track-preview--active" : ""}${
        unavailable ? " track-preview--unavailable" : ""
      }`}
    >
      {isActive ? (
        <span className="track-preview__waveform" aria-hidden="true">
          <span className="track-preview__bar track-preview__bar--1" />
          <span className="track-preview__bar track-preview__bar--2" />
          <span className="track-preview__bar track-preview__bar--3" />
        </span>
      ) : (
        <svg
          width={9}
          height={9}
          viewBox="0 0 9 9"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M1 0.5 L8 4.5 L1 8.5 Z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
