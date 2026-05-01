"use client";

import { useEffect } from "react";
import { Music, X } from "lucide-react";
import { SpotifyImportPicker } from "./SpotifyImportPicker";
import { useSpotifyImport } from "./useSpotifyImport";

const mono = "var(--font-geist-mono)";

interface SpotifyImportModalProps {
  open: boolean;
  onClose: () => void;
}

export function SpotifyImportModal({ open, onClose }: SpotifyImportModalProps) {
  const flow = useSpotifyImport({
    onImported: () => {
      // Slight delay so users see the "Importing…" → success transition
      // before the modal disappears.
      setTimeout(onClose, 800);
    },
  });

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const showPicker =
    flow.phase === "picking" ||
    flow.phase === "importing" ||
    flow.phase === "loading";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.6)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule-strong)",
          width: 480,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <span
            style={{
              fontFamily: mono,
              fontSize: 12,
              color: "var(--ink)",
              letterSpacing: ".08em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            Import from Spotify
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              display: "flex",
              padding: 4,
            }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: "0 20px", overflow: "auto" }}>
          {showPicker ? (
            <SpotifyImportPicker flow={flow} onCancel={onClose} compact />
          ) : (
            <div
              style={{
                padding: "32px 0",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-geist-sans)",
                  fontSize: 14,
                  color: "var(--ink)",
                  letterSpacing: -0.15,
                  maxWidth: 320,
                  lineHeight: 1.5,
                }}
              >
                Connect Spotify to import the artists you follow there as
                followed artists in Showbook.
              </div>
              {flow.importedCount !== null && (
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    color: "var(--accent)",
                    letterSpacing: ".04em",
                  }}
                >
                  Imported {flow.importedCount} artist
                  {flow.importedCount === 1 ? "" : "s"}.
                </div>
              )}
              {flow.error && (
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    color: "#E63946",
                    letterSpacing: ".04em",
                  }}
                >
                  {flow.error}
                </div>
              )}
              <button
                type="button"
                onClick={flow.startConnect}
                style={connectButtonStyle}
              >
                <Music size={13} />
                <span>Connect Spotify</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const connectButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontFamily: "var(--font-geist-sans)",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--ink)",
  background: "transparent",
  border: "1px solid var(--rule-strong)",
  borderRadius: 0,
  padding: "10px 16px",
  cursor: "pointer",
  letterSpacing: -0.2,
};
