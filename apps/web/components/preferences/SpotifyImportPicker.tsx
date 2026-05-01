"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import type { useSpotifyImport } from "./useSpotifyImport";

const mono = "var(--font-geist-mono)";

interface SpotifyImportPickerProps {
  flow: ReturnType<typeof useSpotifyImport>;
  /** Render a compact body (max-height shrinks). Defaults to false. */
  compact?: boolean;
}

export function SpotifyImportPicker({
  flow,
  compact,
}: SpotifyImportPickerProps) {
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim().toLowerCase();
  const filteredArtists = useMemo(() => {
    if (!flow.artists) return [];
    if (!trimmedQuery) return flow.artists;
    return flow.artists.filter((a) =>
      a.name.toLowerCase().includes(trimmedQuery),
    );
  }, [flow.artists, trimmedQuery]);

  if (flow.phase === "loading") {
    return (
      <div
        style={{
          padding: "40px 20px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={loadingDotsStyle}>
          <span style={{ ...dotStyle, animationDelay: "0s" }} />
          <span style={{ ...dotStyle, animationDelay: ".15s" }} />
          <span style={{ ...dotStyle, animationDelay: ".3s" }} />
        </div>
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

  const matchableIds = filteredArtists
    .filter((a) => a.tmMatch && !a.alreadyFollowed)
    .map((a) => a.spotifyId);
  const stats = {
    matchable: filteredArtists.filter((a) => a.tmMatch && !a.alreadyFollowed)
      .length,
    alreadyFollowed: filteredArtists.filter((a) => a.alreadyFollowed).length,
    noMatch: filteredArtists.filter((a) => !a.tmMatch).length,
  };

  const allMatchableSelected =
    matchableIds.length > 0 &&
    matchableIds.every((id) => flow.selected.has(id));

  const handleSelectAll = () => {
    if (allMatchableSelected) {
      matchableIds.forEach((id) => flow.toggle(id, true));
    } else {
      matchableIds.forEach((id) => {
        if (!flow.selected.has(id)) flow.toggle(id, true);
      });
    }
  };

  return (
    <>
      <style>{loadingKeyframes}</style>

      {/* ── Search ─────────────────────────────────────── */}
      <div
        style={{
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <Search size={13} color="var(--muted)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter artists..."
          style={{
            flex: 1,
            border: "none",
            background: "transparent",
            color: "var(--ink)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 13,
            outline: "none",
            letterSpacing: -0.1,
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            style={clearSearchStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--ink)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--muted)";
            }}
            aria-label="Clear filter"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Stats bar ──────────────────────────────────── */}
      <div
        style={{
          padding: "10px 20px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "var(--surface2)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: mono,
            fontSize: 10.5,
            letterSpacing: ".04em",
            flexWrap: "wrap",
          }}
        >
          <Stat
            value={stats.matchable}
            label="importable"
            color="var(--ink)"
            emphasize
          />
          <Sep />
          <Stat
            value={stats.alreadyFollowed}
            label="already followed"
            color="var(--muted)"
          />
          <Sep />
          <Stat
            value={stats.noMatch}
            label="no match"
            color="var(--faint)"
          />
          {flow.meta?.truncated ? (
            <>
              <Sep />
              <span style={{ color: "var(--faint)" }}>
                first {flow.meta.resolved} of {flow.meta.total}
              </span>
            </>
          ) : null}
        </div>
        {matchableIds.length > 0 && (
          <button
            type="button"
            onClick={handleSelectAll}
            style={selectAllStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--ink)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--muted)";
            }}
          >
            {allMatchableSelected ? "Deselect all" : "Select all"}
          </button>
        )}
      </div>

      {/* ── List ──────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          maxHeight: compact ? 360 : 400,
          overflow: "auto",
          minHeight: 0,
        }}
      >
        {filteredArtists.length === 0 && (
          <div
            style={{
              padding: "32px 20px",
              textAlign: "center",
              fontFamily: mono,
              fontSize: 11,
              color: "var(--muted)",
              letterSpacing: ".04em",
            }}
          >
            {trimmedQuery ? "No artists match your filter." : "No artists."}
          </div>
        )}
        {filteredArtists.map((artist) => {
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
                padding: "11px 20px",
                borderBottom: "1px solid var(--rule)",
                cursor: importable ? "pointer" : "not-allowed",
                opacity: importable ? 1 : 0.55,
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => {
                if (importable)
                  e.currentTarget.style.background = "var(--surface2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <Checkbox
                checked={artist.alreadyFollowed || (isSelected && importable)}
                disabled={!importable}
              />
              {artist.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={artist.imageUrl}
                  alt=""
                  width={36}
                  height={36}
                  style={{
                    width: 36,
                    height: 36,
                    objectFit: "cover",
                    flexShrink: 0,
                    borderRadius: 4,
                    border: "1px solid var(--rule)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 36,
                    height: 36,
                    background: "var(--surface2)",
                    border: "1px solid var(--rule)",
                    flexShrink: 0,
                    borderRadius: 4,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-geist-sans)",
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--ink)",
                    letterSpacing: -0.2,
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
                      color: artist.alreadyFollowed
                        ? "var(--muted)"
                        : "var(--faint)",
                      marginTop: 3,
                      letterSpacing: ".04em",
                      textTransform: "uppercase",
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

      {/* ── Footer with action ───────────────────────── */}
      <div
        style={{
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          borderTop: "1px solid var(--rule)",
          background: "var(--surface)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontFamily: mono,
            fontSize: 11,
            color: flow.selected.size > 0 ? "var(--ink)" : "var(--muted)",
            letterSpacing: ".04em",
            fontWeight: flow.selected.size > 0 ? 500 : 400,
          }}
        >
          {flow.selected.size > 0 ? (
            <>
              <span style={{ color: "var(--accent)" }}>
                {flow.selected.size}
              </span>{" "}
              selected
            </>
          ) : (
            "None selected"
          )}
        </div>
        {flow.error && (
          <div
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              color: "#E63946",
              letterSpacing: ".04em",
              flex: 1,
              textAlign: "center",
            }}
          >
            {flow.error}
          </div>
        )}
        <button
          type="button"
          onClick={flow.submitImport}
          disabled={flow.selected.size === 0 || flow.isImporting}
          style={{
            ...importButtonStyle,
            opacity: flow.selected.size === 0 || flow.isImporting ? 0.4 : 1,
            cursor:
              flow.selected.size === 0 || flow.isImporting
                ? "not-allowed"
                : "pointer",
          }}
        >
          {flow.isImporting
            ? "Importing…"
            : `Import ${flow.selected.size || ""} ${flow.selected.size === 1 ? "artist" : "artists"}`.trim()}
        </button>
      </div>
    </>
  );
}

function Stat({
  value,
  label,
  color,
  emphasize,
}: {
  value: number;
  label: string;
  color: string;
  emphasize?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 5,
        color,
      }}
    >
      <span
        style={{
          fontWeight: emphasize ? 600 : 500,
          color: emphasize ? "var(--accent)" : color,
          fontFeatureSettings: '"tnum"',
        }}
      >
        {value}
      </span>
      <span style={{ color: "var(--faint)" }}>{label}</span>
    </span>
  );
}

function Sep() {
  return <span style={{ color: "var(--faint)" }}>·</span>;
}

function Checkbox({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <div
      style={{
        width: 18,
        height: 18,
        border: "1.5px solid",
        borderColor: checked ? "var(--accent)" : "var(--rule-strong)",
        background: checked ? "var(--accent)" : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        borderRadius: 3,
        transition: "all 0.12s",
        opacity: disabled && !checked ? 0.4 : 1,
      }}
    >
      {checked && <Check size={12} color="var(--accent-text)" strokeWidth={3} />}
    </div>
  );
}

const clearSearchStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  fontWeight: 500,
  color: "var(--muted)",
  background: "transparent",
  border: "none",
  padding: "2px 6px",
  cursor: "pointer",
  letterSpacing: ".08em",
  textTransform: "uppercase",
  flexShrink: 0,
  transition: "color 0.12s",
};

const selectAllStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  fontWeight: 500,
  color: "var(--muted)",
  background: "transparent",
  border: "none",
  padding: 0,
  cursor: "pointer",
  letterSpacing: ".08em",
  textTransform: "uppercase",
  flexShrink: 0,
  textDecoration: "underline",
  textDecorationColor: "var(--rule-strong)",
  textUnderlineOffset: 3,
  transition: "color 0.12s",
};

const importButtonStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--accent-text)",
  background: "var(--accent)",
  border: "none",
  borderRadius: 0,
  padding: "9px 16px",
  letterSpacing: ".08em",
  textTransform: "uppercase",
  transition: "opacity 0.12s",
  whiteSpace: "nowrap",
};

const dotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "var(--muted)",
  display: "inline-block",
  animation: "spotify-pick-pulse 1.2s ease-in-out infinite",
};

const loadingDotsStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "center",
};

const loadingKeyframes = `
@keyframes spotify-pick-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}
`;
