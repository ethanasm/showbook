"use client";

import { Check } from "lucide-react";
import type { useSpotifyImport } from "./useSpotifyImport";

const mono = "var(--font-geist-mono)";

interface SpotifyImportPickerProps {
  flow: ReturnType<typeof useSpotifyImport>;
  /** Called when the user hits Cancel. Defaults to flow.reset(). */
  onCancel?: () => void;
  /** Render a compact body (max-height shrinks). Defaults to false. */
  compact?: boolean;
}

export function SpotifyImportPicker({
  flow,
  onCancel,
  compact,
}: SpotifyImportPickerProps) {
  const handleCancel = onCancel ?? flow.reset;

  if (flow.phase === "loading") {
    return (
      <div style={{ padding: "20px 0", textAlign: "center" }}>
        <div
          style={{
            fontFamily: mono,
            fontSize: 11,
            color: "var(--muted)",
            letterSpacing: ".04em",
          }}
        >
          Loading your Spotify followed artists…
        </div>
      </div>
    );
  }

  if (!flow.artists) return null;

  const stats = (() => {
    const matchable = flow.artists.filter((a) => a.tmMatch && !a.alreadyFollowed);
    const alreadyFollowed = flow.artists.filter((a) => a.alreadyFollowed);
    const noMatch = flow.artists.filter((a) => !a.tmMatch);
    return {
      matchable: matchable.length,
      alreadyFollowed: alreadyFollowed.length,
      noMatch: noMatch.length,
    };
  })();

  return (
    <>
      <div
        style={{
          padding: "14px 0",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-geist-sans)",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--ink)",
              letterSpacing: -0.15,
            }}
          >
            Pick artists to import
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
            {stats.matchable} importable · {stats.alreadyFollowed} already followed ·{" "}
            {stats.noMatch} no Ticketmaster match
            {flow.meta?.truncated
              ? ` · showing first ${flow.meta.resolved} of ${flow.meta.total}`
              : ""}
          </div>
        </div>
        <button type="button" onClick={handleCancel} style={cancelButtonStyle}>
          Cancel
        </button>
      </div>

      <div
        style={{
          maxHeight: compact ? 320 : 360,
          overflow: "auto",
          padding: "4px 0",
        }}
      >
        {flow.artists.map((artist) => {
          const importable = Boolean(artist.tmMatch) && !artist.alreadyFollowed;
          const isSelected = flow.selected.has(artist.spotifyId);
          const status = artist.alreadyFollowed
            ? "already followed"
            : artist.tmMatch
              ? null
              : "no events on Ticketmaster";

          return (
            <div
              key={artist.spotifyId}
              onClick={() => flow.toggle(artist.spotifyId, importable)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 4px",
                borderBottom: "1px solid var(--rule)",
                cursor: importable ? "pointer" : "not-allowed",
                opacity: importable ? 1 : 0.45,
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  border: "1.5px solid",
                  borderColor:
                    artist.alreadyFollowed
                      ? "var(--accent)"
                      : isSelected && importable
                        ? "var(--accent)"
                        : "var(--rule-strong)",
                  background:
                    artist.alreadyFollowed
                      ? "var(--accent)"
                      : isSelected && importable
                        ? "var(--accent)"
                        : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {(artist.alreadyFollowed || (isSelected && importable)) && (
                  <Check size={11} color="var(--accent-text)" strokeWidth={3} />
                )}
              </div>
              {artist.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={artist.imageUrl}
                  alt=""
                  width={32}
                  height={32}
                  style={{ width: 32, height: 32, objectFit: "cover", flexShrink: 0 }}
                />
              ) : (
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "var(--surface2)",
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-geist-sans)",
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: "var(--ink)",
                    letterSpacing: -0.15,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {artist.name}
                </div>
                {status && (
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      color: "var(--faint)",
                      marginTop: 2,
                      letterSpacing: ".04em",
                    }}
                  >
                    {status}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {flow.error && (
        <div
          style={{
            fontFamily: mono,
            fontSize: 10.5,
            color: "#E63946",
            padding: "8px 0",
            letterSpacing: ".04em",
          }}
        >
          {flow.error}
        </div>
      )}

      <div
        style={{
          padding: "14px 0 4px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: mono,
            fontSize: 10.5,
            color: "var(--muted)",
            letterSpacing: ".04em",
          }}
        >
          {flow.selected.size} selected
        </div>
        <button
          type="button"
          onClick={flow.submitImport}
          disabled={flow.selected.size === 0 || flow.isImporting}
          style={{
            ...importButtonStyle,
            opacity: flow.selected.size === 0 || flow.isImporting ? 0.4 : 1,
            cursor:
              flow.selected.size === 0 || flow.isImporting ? "not-allowed" : "pointer",
          }}
        >
          {flow.isImporting
            ? "Importing…"
            : `Import ${flow.selected.size} artist${flow.selected.size === 1 ? "" : "s"}`}
        </button>
      </div>
    </>
  );
}

const cancelButtonStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  fontWeight: 500,
  color: "var(--muted)",
  background: "transparent",
  border: "1px solid var(--rule-strong)",
  borderRadius: 0,
  padding: "5px 10px",
  cursor: "pointer",
  letterSpacing: ".06em",
  textTransform: "uppercase",
  flexShrink: 0,
};

const importButtonStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--accent-text)",
  background: "var(--accent)",
  border: "none",
  borderRadius: 0,
  padding: "8px 16px",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  transition: "opacity 0.15s ease",
};
