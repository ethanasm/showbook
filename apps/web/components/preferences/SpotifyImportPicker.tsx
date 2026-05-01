"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import type { useSpotifyImport } from "./useSpotifyImport";

const LOADING_STAGES = [
  "Fetching your followed artists",
  "Matching with Ticketmaster",
  "Almost ready",
];

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
    return <SpotifyImportLoading compact={compact} />;
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

function SpotifyImportLoading({ compact }: { compact?: boolean }) {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, LOADING_STAGES.length - 1));
    }, 1800);
    return () => window.clearInterval(id);
  }, []);

  const rowCount = compact ? 5 : 6;

  return (
    <>
      <style>{loadingKeyframes}</style>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Indeterminate shimmer bar */}
        <div
          style={{
            position: "relative",
            height: 2,
            overflow: "hidden",
            background: "var(--rule)",
          }}
          aria-hidden
        >
          <div style={shimmerBarStyle} />
        </div>

        {/* Skeleton rows */}
        <div
          role="status"
          aria-live="polite"
          aria-label="Loading your Spotify followed artists"
          style={{
            maxHeight: compact ? 360 : 400,
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          {Array.from({ length: rowCount }).map((_, i) => (
            <SkeletonRow key={i} index={i} />
          ))}
        </div>

        {/* Status caption */}
        <div
          style={{
            padding: "14px 20px 18px",
            borderTop: "1px solid var(--rule)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: "var(--surface)",
          }}
        >
          <span style={spinnerStyle} aria-hidden />
          <span
            key={stageIndex}
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: "var(--muted)",
              letterSpacing: ".04em",
              animation: "spotify-load-fade .35s ease-out",
            }}
          >
            {LOADING_STAGES[stageIndex]}…
          </span>
        </div>
      </div>
    </>
  );
}

function SkeletonRow({ index }: { index: number }) {
  const delay = `${index * 0.08}s`;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 20px",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <div style={{ ...skeletonBoxStyle, width: 18, height: 18, borderRadius: 3, animationDelay: delay }} />
      <div style={{ ...skeletonBoxStyle, width: 36, height: 36, borderRadius: 4, animationDelay: delay }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            ...skeletonBoxStyle,
            height: 11,
            width: `${45 + ((index * 13) % 35)}%`,
            borderRadius: 2,
            animationDelay: delay,
          }}
        />
        <div
          style={{
            ...skeletonBoxStyle,
            height: 8,
            width: `${22 + ((index * 7) % 20)}%`,
            borderRadius: 2,
            animationDelay: delay,
            opacity: 0.6,
          }}
        />
      </div>
    </div>
  );
}

const skeletonBoxStyle: React.CSSProperties = {
  background:
    "linear-gradient(90deg, var(--surface2) 0%, var(--rule-strong) 50%, var(--surface2) 100%)",
  backgroundSize: "200% 100%",
  animation: "spotify-load-shimmer 1.4s ease-in-out infinite",
  flexShrink: 0,
};

const shimmerBarStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  height: "100%",
  width: "40%",
  background:
    "linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)",
  animation: "spotify-load-bar 1.4s ease-in-out infinite",
};

const spinnerStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  border: "1.5px solid var(--rule-strong)",
  borderTopColor: "var(--accent)",
  display: "inline-block",
  animation: "spotify-load-spin .9s linear infinite",
};

const loadingKeyframes = `
@keyframes spotify-load-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
@keyframes spotify-load-bar {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}
@keyframes spotify-load-spin {
  to { transform: rotate(360deg); }
}
@keyframes spotify-load-fade {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}
`;
