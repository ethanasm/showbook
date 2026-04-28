"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Music, ArrowDownUp, Search } from "lucide-react";

type SortMode = "recent" | "count" | "alpha";

export default function ArtistsPage() {
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [search, setSearch] = useState("");

  const { data: artists, isLoading, error } = trpc.performers.list.useQuery();

  const filtered = useMemo(() => {
    let result = artists ?? [];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((a) => a.name.toLowerCase().includes(q));
    }

    result = [...result].sort((a, b) => {
      if (sortMode === "count") return b.showCount - a.showCount;
      if (sortMode === "alpha") return a.name.localeCompare(b.name);
      return (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");
    });

    return result;
  }, [artists, search, sortMode]);

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, fontFamily: "var(--font-geist-mono), monospace", fontSize: "0.85rem", color: "var(--muted)" }}>
        Loading artists...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, fontFamily: "var(--font-geist-mono), monospace", fontSize: "0.85rem", color: "var(--kind-theatre)" }}>
        Failed to load artists.
      </div>
    );
  }

  const total = (artists ?? []).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div style={{
        padding: "16px 36px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid var(--rule)",
      }}>
        <div>
          <div style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--muted)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
          }}>
            Performers you&apos;ve seen live
          </div>
          <div style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 26,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: -0.9,
            marginTop: 4,
          }}>
            Artists
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{
        padding: "11px 36px",
        display: "flex",
        alignItems: "center",
        gap: 18,
        background: "var(--surface)",
        borderBottom: "1px solid var(--rule)",
      }}>
        {/* Search */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          border: "1px solid var(--rule-strong)",
          minWidth: 200,
        }}>
          <Search size={12} color="var(--muted)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter artists..."
            style={{
              border: "none",
              background: "transparent",
              color: "var(--ink)",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              outline: "none",
              width: "100%",
              letterSpacing: ".02em",
            }}
          />
        </div>

        <span style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--muted)",
        }}>
          &middot;
        </span>

        {/* Sort */}
        <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid var(--rule-strong)" }}>
          {([
            { k: "recent" as SortMode, l: "Recent" },
            { k: "count" as SortMode, l: "Most seen" },
            { k: "alpha" as SortMode, l: "A–Z" },
          ]).map(({ k, l }, i, arr) => {
            const active = sortMode === k;
            return (
              <div
                key={k}
                onClick={() => setSortMode(k)}
                style={{
                  padding: "5px 11px",
                  borderRight: i === arr.length - 1 ? "none" : "1px solid var(--rule-strong)",
                  background: active ? "var(--ink)" : "transparent",
                  color: active ? "var(--bg)" : "var(--ink)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  fontWeight: active ? 500 : 400,
                  cursor: "pointer",
                  letterSpacing: ".02em",
                }}
              >
                {l}
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--faint)",
          letterSpacing: ".04em",
        }}>
          {filtered.length} artist{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)" }}>
        <div style={{ padding: "18px 36px 8px", display: "flex", alignItems: "baseline", gap: 14 }}>
          <div style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: "var(--ink)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}>
            {search ? "Matching" : "All artists"} &middot; {filtered.length}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, fontFamily: "var(--font-geist-sans), sans-serif", fontSize: "1rem", color: "var(--muted)" }}>
            {search ? "No artists match your search." : "No artists yet. Add your first show!"}
          </div>
        ) : (
          <div style={{ margin: "4px 36px 36px", background: "var(--surface)" }}>
            {/* Column headers */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1.5fr 80px 110px 110px",
              columnGap: 16,
              padding: "10px 20px",
              borderBottom: "1px solid var(--rule)",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 9.5,
              color: "var(--faint)",
              letterSpacing: ".12em",
              textTransform: "uppercase",
            }}>
              <div>Name</div>
              <div style={{ textAlign: "right" }}>Shows</div>
              <div>First seen</div>
              <div>Last seen</div>
            </div>

            {filtered.map((artist) => (
              <Link
                key={artist.id}
                href={`/artists/${artist.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.5fr 80px 110px 110px",
                  columnGap: 16,
                  padding: "12px 20px",
                  borderBottom: "1px solid var(--rule)",
                  alignItems: "center",
                  cursor: "pointer",
                  color: "inherit",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Music size={14} color="var(--muted)" style={{ flexShrink: 0 }} />
                  <span style={{
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--ink)",
                    letterSpacing: -0.2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {artist.name}
                  </span>
                </div>
                <div style={{
                  textAlign: "right",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--ink)",
                  fontFeatureSettings: '"tnum"',
                }}>
                  {artist.showCount}&times;
                </div>
                <div style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "var(--muted)",
                  letterSpacing: ".02em",
                }}>
                  {artist.firstSeen ? formatDate(artist.firstSeen) : "—"}
                </div>
                <div style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "var(--muted)",
                  letterSpacing: ".02em",
                }}>
                  {artist.lastSeen ? formatDate(artist.lastSeen) : "—"}
                </div>
              </Link>
            ))}

            <div style={{
              padding: "16px 20px",
              textAlign: "center",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--faint)",
              letterSpacing: ".1em",
            }}>
              {filtered.length} artist{filtered.length !== 1 ? "s" : ""} total
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
