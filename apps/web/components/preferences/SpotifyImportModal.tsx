"use client";

import { useEffect } from "react";
import { Music, X } from "lucide-react";
import { SpotifyImportPicker } from "./SpotifyImportPicker";
import { useSpotifyImport } from "./useSpotifyImport";

const mono = "var(--font-geist-mono)";

interface SpotifyImportModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Forwarded to `useSpotifyImport`. Fires once the import mutation
   * resolves; lets the hosting view drive a post-close "still importing
   * upcoming-show data…" indicator.
   */
  onImported?: (result: { count: number; performerIds: string[] }) => void;
}

export function SpotifyImportModal({
  open,
  onClose,
  onImported,
}: SpotifyImportModalProps) {
  const flow = useSpotifyImport({
    onImported: (result) => {
      onImported?.(result);
      // Slight delay so users see the "Importing…" → success transition
      // before the modal disappears.
      setTimeout(onClose, 800);
    },
  });

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
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 8,
          width: "100%",
          maxWidth: 520,
          maxHeight: "min(640px, 88vh)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px -12px rgba(0,0,0,.5)",
        }}
      >
        <div
          style={{
            padding: "16px 20px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 28,
                height: 28,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--surface2)",
                border: "1px solid var(--rule)",
                color: "var(--accent)",
                flexShrink: 0,
                borderRadius: 6,
              }}
            >
              <Music size={14} />
            </span>
            <span
              className="display-title"
              style={{
                fontSize: 16,
                color: "var(--ink)",
              }}
            >
              Import from Spotify
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={closeButtonStyle}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          {showPicker ? (
            <SpotifyImportPicker flow={flow} compact />
          ) : (
            <div
              style={{
                padding: "36px 28px 32px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-geist-sans)",
                  fontSize: 14,
                  color: "var(--muted)",
                  letterSpacing: -0.1,
                  maxWidth: 340,
                  lineHeight: 1.55,
                }}
              >
                Connect Spotify to bring the artists you follow there into
                Showbook so you can track their tour announcements.
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
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "0.9";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                }}
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

const closeButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--muted)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 4,
  borderRadius: 4,
  transition: "color 0.12s",
};

const connectButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontFamily: "var(--font-geist-mono), monospace",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--accent-text)",
  background: "var(--accent)",
  border: "none",
  borderRadius: 0,
  padding: "10px 18px",
  cursor: "pointer",
  letterSpacing: ".08em",
  textTransform: "uppercase",
  transition: "opacity 0.12s",
  marginTop: 4,
};
