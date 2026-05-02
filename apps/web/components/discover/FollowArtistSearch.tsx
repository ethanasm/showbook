"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

interface FollowArtistSearchProps {
  /** Initial expanded state. Empty-state CTAs default to expanded. */
  defaultOpen?: boolean;
  /** Render the collapsed trigger as a small inline link (rail) or a
   *  larger button (empty state). */
  variant?: "rail" | "cta";
  onFollowed?: () => void;
}

export function FollowArtistSearch({
  defaultOpen = false,
  variant = "rail",
  onFollowed,
}: FollowArtistSearchProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const debounced = useDebouncedValue(query.length >= 2 ? query : "", 350);

  const results = trpc.discover.searchArtists.useQuery(
    { keyword: debounced },
    { enabled: debounced.length >= 2 },
  );

  const followAttraction = trpc.performers.followAttraction.useMutation({
    onSuccess: () => {
      utils.discover.followedArtistsFeed.invalidate();
      utils.performers.followed.invalidate();
      utils.performers.list.invalidate();
      utils.discover.ingestStatus.invalidate();
      setOpen(false);
      setQuery("");
      onFollowed?.();
    },
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    if (variant === "cta") {
      return (
        <button type="button" onClick={() => setOpen(true)} style={ctaButtonStyle}>
          <Plus size={13} />
          Follow an Artist
        </button>
      );
    }
    return (
      <button
        type="button"
        className="discover-rail__follow-link"
        onClick={() => setOpen(true)}
      >
        <Plus size={11} />
        Follow another artist
      </button>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          borderBottom: "1px solid var(--rule)",
          paddingBottom: 6,
        }}
      >
        <Search size={11} color="var(--muted)" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artists..."
          style={{
            flex: 1,
            background: "none",
            border: "none",
            outline: "none",
            color: "var(--ink)",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
          }}
        />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--muted)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <X size={11} />
        </button>
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {debounced.length >= 2 && results.isLoading && (
          <div
            style={{
              padding: "6px 0",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10,
              color: "var(--muted)",
            }}
          >
            Searching...
          </div>
        )}
        {results.data?.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() =>
              followAttraction.mutate({
                tmAttractionId: a.id,
                name: a.name,
                imageUrl: a.imageUrl ?? undefined,
                musicbrainzId: a.mbid ?? undefined,
              })
            }
            disabled={followAttraction.isPending}
            style={{
              display: "block",
              width: "100%",
              padding: "6px 0",
              background: "none",
              border: "none",
              borderBottom: "1px solid var(--rule)",
              textAlign: "left",
              cursor: "pointer",
              opacity: followAttraction.isPending ? 0.5 : 1,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 12,
                color: "var(--ink)",
                fontWeight: 500,
              }}
            >
              {a.name}
            </div>
          </button>
        ))}
        {debounced.length >= 2 &&
          !results.isLoading &&
          (results.data?.length ?? 0) === 0 && (
            <div
              style={{
                padding: "6px 0",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10,
                color: "var(--muted)",
              }}
            >
              No artists found
            </div>
          )}
      </div>
    </div>
  );
}

const ctaButtonStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "var(--accent)",
  color: "var(--accent-text)",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontFamily: "var(--font-geist-mono), monospace",
  fontSize: 11,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  fontWeight: 500,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};
