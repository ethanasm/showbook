"use client";

import {
  flattenSetlistTitles,
  setlistTotalSongs,
  singleMainSet,
  type PerformerSetlist,
} from "@showbook/shared";

interface PerformerSetlistBlockProps {
  performerName: string;
  setlist: PerformerSetlist | null;
  loading: boolean;
  fetchingFor: Record<string, boolean>;
  onFetch: () => Promise<void>;
  /**
   * Called when the user types in the textarea. Receives a single-main-set
   * setlist built from the textarea lines. Encore + per-song notes are
   * preserved when the data came from setlist.fm but cannot be edited from
   * this block — that lives on the show detail page.
   */
  onChange: (next: PerformerSetlist) => void;
}

export function PerformerSetlistBlock({
  performerName,
  setlist,
  loading,
  fetchingFor,
  onFetch,
  onChange,
}: PerformerSetlistBlockProps) {
  const isFetching = fetchingFor[performerName] ?? loading;
  const songCount = setlist ? setlistTotalSongs(setlist) : 0;
  const hasSongs = songCount > 0;
  const flatTitles = setlist ? flattenSetlistTitles(setlist) : [];

  return (
    <div
      data-testid={`setlist-block-${performerName.replace(/\s+/g, "-").toLowerCase()}`}
      style={{
        marginBottom: 12,
        border: "1px solid var(--rule-strong)",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: hasSongs ? "1px solid var(--rule)" : "none",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: -0.1,
          }}
        >
          {performerName}
        </span>
        <button
          type="button"
          data-testid={`search-setlist-${performerName.replace(/\s+/g, "-").toLowerCase()}`}
          onClick={onFetch}
          disabled={isFetching}
          style={{
            padding: "5px 10px",
            background: "transparent",
            border: "1px solid var(--rule-strong)",
            color: isFetching ? "var(--faint)" : "var(--muted)",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            cursor: isFetching ? "default" : "pointer",
          }}
        >
          {isFetching ? "fetching..." : "Search setlist.fm"}
        </button>
      </div>
      {hasSongs && setlist && (
        <div
          style={{
            padding: "8px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {setlist.sections.map((section, sIdx) => {
            const isEncore = section.kind === "encore";
            return (
              <div
                key={`${section.kind}-${sIdx}`}
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                {isEncore && (
                  <span
                    data-testid="setlist-block-encore-marker"
                    style={{
                      alignSelf: "flex-start",
                      background: "var(--surface2)",
                      color: "var(--accent)",
                      padding: "2px 8px",
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 9,
                      letterSpacing: ".1em",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      borderRadius: 999,
                      border: "1px solid var(--accent)",
                    }}
                  >
                    Encore
                  </span>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {section.songs.map((song, i) => (
                    <span
                      key={`${sIdx}-${i}`}
                      title={song.note}
                      style={{
                        display: "inline-block",
                        padding: "3px 8px",
                        background: isEncore ? "var(--surface2)" : "var(--surface2)",
                        color: "var(--ink)",
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 10.5,
                        letterSpacing: ".02em",
                        borderLeft: isEncore
                          ? "2px solid var(--accent)"
                          : undefined,
                      }}
                    >
                      {song.title}
                      {song.note && (
                        <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                          · {song.note}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!hasSongs && !isFetching && (
        <div style={{ padding: "8px 14px" }}>
          <textarea
            placeholder="Enter songs one per line..."
            value={flatTitles.join("\n")}
            onChange={(e) => {
              const lines = e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              onChange(singleMainSet(lines));
            }}
            rows={3}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "var(--ink)",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </div>
      )}
    </div>
  );
}
