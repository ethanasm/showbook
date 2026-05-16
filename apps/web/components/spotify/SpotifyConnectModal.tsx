"use client";

import { useEffect, useRef } from "react";
import { Music } from "lucide-react";

const mono = "var(--font-geist-mono)";

/**
 * The universal "Connect Spotify" modal. Mounted once per
 * `useSpotifyConnection()` consumer; the hook handles open/close +
 * popup wiring. Copy is generic so the same modal fits every entry
 * point (artist import, hype playlist, save-to-Spotify, etc.).
 *
 * Visual rules:
 *   - Centered overlay, surface-bg card, rule-strong border.
 *   - One primary button (Connect) + a secondary "Not now" link.
 *   - Optional inline error row when the popup post-back failed.
 *   - Click-outside / Escape closes via `onClose`.
 *
 * The `ctaLabel` lets each call site explain *what* the user is about
 * to do (e.g. "Connect to make a hype playlist for tonight's show").
 * Falls back to a generic intro when not provided.
 */
export interface SpotifyConnectModalProps {
  open: boolean;
  /** Inline copy below the icon — context for the action that triggered the modal. */
  ctaLabel?: string;
  /** Inline error string surfaced under the Connect button. */
  error?: string | null;
  onConnect: () => void;
  onClose: () => void;
}

export function SpotifyConnectModal(props: SpotifyConnectModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  if (!props.open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="spotify-connect-title"
      style={overlayStyle}
      onClick={(e) => {
        // Click-outside-to-close. Inner clicks bubble up; the inner card
        // calls e.stopPropagation() to prevent that.
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={dialogRef}
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={iconRowStyle}>
          <Music size={18} aria-hidden />
          <span id="spotify-connect-title" style={titleStyle}>
            Connect Spotify
          </span>
        </div>
        <p style={bodyStyle}>
          {props.ctaLabel ??
            "Showbook uses Spotify to make playlists, identify songs, and surface stats about your shows. Connect once and we'll handle the rest."}
        </p>
        <p style={privacyStyle}>
          We&apos;ll never post on your behalf. You can disconnect any time
          from Preferences or your Spotify account.
        </p>
        <button
          type="button"
          onClick={props.onConnect}
          style={primaryButtonStyle}
          data-testid="spotify-connect-button"
        >
          Connect Spotify →
        </button>
        {props.error ? (
          <div role="alert" style={errorStyle}>
            {props.error}
          </div>
        ) : null}
        <button
          type="button"
          onClick={props.onClose}
          style={secondaryButtonStyle}
          data-testid="spotify-connect-cancel"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 24,
};

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--rule-strong)",
  borderRadius: 8,
  width: "100%",
  maxWidth: 420,
  padding: "28px 24px 22px",
  display: "flex",
  flexDirection: "column",
  gap: 14,
  fontFamily: "var(--font-geist-sans)",
  color: "var(--ink)",
};

const iconRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "var(--ink)",
};

const titleStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--ink)",
};

const bodyStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--ink)",
  margin: 0,
};

const privacyStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10.5,
  lineHeight: 1.6,
  letterSpacing: ".03em",
  color: "var(--muted)",
  margin: 0,
};

const primaryButtonStyle: React.CSSProperties = {
  marginTop: 6,
  fontFamily: mono,
  fontSize: 11,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  fontWeight: 500,
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
  borderRadius: 0,
  padding: "12px 18px",
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10.5,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  background: "transparent",
  color: "var(--muted)",
  border: "none",
  cursor: "pointer",
  padding: "8px",
  alignSelf: "center",
};

const errorStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10.5,
  letterSpacing: ".04em",
  color: "#E63946",
  marginTop: -4,
};
