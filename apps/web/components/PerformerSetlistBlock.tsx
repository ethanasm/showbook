"use client";

interface PerformerSetlistBlockProps {
  performerName: string;
  songs: string[] | null;
  loading: boolean;
  fetchingFor: Record<string, boolean>;
  onFetch: () => Promise<void>;
  onChange: (songs: string[]) => void;
}

export function PerformerSetlistBlock({
  performerName,
  songs,
  loading,
  fetchingFor,
  onFetch,
  onChange,
}: PerformerSetlistBlockProps) {
  const isFetching = fetchingFor[performerName] ?? loading;
  const hasSongs = songs && songs.length > 0;

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
      {hasSongs && (
        <div
          style={{
            padding: "8px 14px",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          {songs.map((song, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                padding: "3px 8px",
                background: "var(--surface2)",
                color: "var(--ink)",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                letterSpacing: ".02em",
              }}
            >
              {song}
            </span>
          ))}
        </div>
      )}
      {!hasSongs && !isFetching && (
        <div style={{ padding: "8px 14px" }}>
          <textarea
            placeholder="Enter songs one per line..."
            value={(songs ?? []).join("\n")}
            onChange={(e) =>
              onChange(e.target.value.split("\n").filter(Boolean))
            }
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
