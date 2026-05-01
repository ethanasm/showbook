"use client";

import { Music } from "lucide-react";
import { SpotifyImportPicker } from "./SpotifyImportPicker";
import { useSpotifyImport } from "./useSpotifyImport";

const mono = "var(--font-geist-mono)";

export function SpotifyImport() {
  const flow = useSpotifyImport();

  // ────── Picking / importing — render the picker inline ──────
  if (flow.phase === "picking" || flow.phase === "importing" || flow.phase === "loading") {
    return (
      <div style={cardStyle}>
        <SpotifyImportPicker flow={flow} />
      </div>
    );
  }

  // ────── Empty / connect / done state ──────
  return (
    <div style={cardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "14px 0",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-geist-sans)",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--ink)",
              letterSpacing: -0.15,
            }}
          >
            Spotify
          </div>
          <div
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              color: "var(--muted)",
              marginTop: 3,
              letterSpacing: ".04em",
            }}
          >
            import the artists you follow on Spotify
          </div>
          {flow.importedCount !== null && (
            <div
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                color: "var(--accent)",
                marginTop: 6,
                letterSpacing: ".04em",
              }}
            >
              Imported {flow.importedCount} artist{flow.importedCount === 1 ? "" : "s"}.
            </div>
          )}
          {flow.error && (
            <div
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                color: "#E63946",
                marginTop: 6,
                letterSpacing: ".04em",
              }}
            >
              {flow.error}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={flow.startConnect}
          style={connectButtonStyle}
        >
          <Music size={12} />
          <span>Connect Spotify</span>
        </button>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  padding: "4px 20px 4px",
  marginBottom: 36,
};

const connectButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: mono,
  fontSize: 10.5,
  fontWeight: 500,
  color: "var(--ink)",
  background: "transparent",
  border: "1px solid var(--rule-strong)",
  borderRadius: 0,
  padding: "6px 12px",
  cursor: "pointer",
  letterSpacing: ".06em",
  textTransform: "uppercase",
  flexShrink: 0,
};
