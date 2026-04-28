"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { MapPin, Search } from "lucide-react";
import { SortHeader, type SortConfig } from "@/components/SortHeader";

type SortField = "name" | "state" | "city" | "past" | "future";

const DEFAULT_DIR: Record<SortField, "asc" | "desc"> = {
  name: "asc",
  state: "asc",
  city: "asc",
  past: "desc",
  future: "desc",
};

export default function VenuesListPage() {
  const [sort, setSort] = useState<SortConfig<SortField>>({
    field: "past",
    dir: "desc",
  });
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = trpc.venues.list.useQuery();

  const toggleSort = useCallback((field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: DEFAULT_DIR[field] },
    );
  }, []);

  const filtered = useMemo(() => {
    let result = data ?? [];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.city.toLowerCase().includes(q) ||
          (v.stateRegion ?? "").toLowerCase().includes(q),
      );
    }

    const flip = sort.dir === "asc" ? 1 : -1;
    const cmpStr = (a: string | null, b: string | null) => {
      if (a === b) return 0;
      if (a == null) return 1; // nulls last in asc, but consistent under flip
      if (b == null) return -1;
      return a.localeCompare(b);
    };

    result = [...result].sort((a, b) => {
      switch (sort.field) {
        case "name":
          return cmpStr(a.name, b.name) * flip;
        case "state":
          return cmpStr(a.stateRegion, b.stateRegion) * flip;
        case "city":
          return cmpStr(a.city, b.city) * flip;
        case "past":
          return (a.pastShowsCount - b.pastShowsCount) * flip;
        case "future":
          return (a.futureShowsCount - b.futureShowsCount) * flip;
      }
    });

    return result;
  }, [data, search, sort]);

  if (isLoading) {
    return (
      <CenteredMessage>Loading venues…</CenteredMessage>
    );
  }

  if (error) {
    return (
      <CenteredMessage tone="error">Failed to load venues.</CenteredMessage>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
            }}
          >
            Places you&apos;ve been
          </div>
          <div
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 26,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: -0.9,
              marginTop: 4,
            }}
          >
            Venues
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          padding: "11px 36px",
          display: "flex",
          alignItems: "center",
          gap: 18,
          background: "var(--surface)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            border: "1px solid var(--rule-strong)",
            minWidth: 220,
          }}
        >
          <Search size={12} color="var(--muted)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter venues, cities, states..."
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

        <div style={{ flex: 1 }} />

        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--faint)",
            letterSpacing: ".04em",
          }}
        >
          {filtered.length} venue{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* List */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
        }}
      >
        <div
          style={{
            padding: "18px 36px 8px",
            display: "flex",
            alignItems: "baseline",
            gap: 14,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "var(--ink)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {search ? "Matching" : "All venues"} &middot; {filtered.length}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 300,
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "1rem",
              color: "var(--muted)",
            }}
          >
            {search
              ? "No venues match your search."
              : "No venues yet. Add your first show!"}
          </div>
        ) : (
          <div style={{ margin: "4px 36px 36px", background: "var(--surface)" }}>
            {/* Column headers */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.5fr 110px 120px 80px 80px 70px 70px",
                columnGap: 16,
                padding: "10px 20px",
                borderBottom: "1px solid var(--rule)",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 9.5,
                color: "var(--faint)",
                letterSpacing: ".12em",
                textTransform: "uppercase",
              }}
            >
              <SortHeader<SortField>
                field="name"
                label="Name"
                sort={sort}
                onToggle={toggleSort}
              />
              <SortHeader<SortField>
                field="state"
                label="State"
                sort={sort}
                onToggle={toggleSort}
              />
              <SortHeader<SortField>
                field="city"
                label="City"
                sort={sort}
                onToggle={toggleSort}
              />
              <SortHeader<SortField>
                field="past"
                label="Past"
                sort={sort}
                onToggle={toggleSort}
                align="right"
              />
              <SortHeader<SortField>
                field="future"
                label="Future"
                sort={sort}
                onToggle={toggleSort}
                align="right"
              />
              <div>TM</div>
              <div>GP</div>
            </div>

            {filtered.map((v) => (
              <Link
                key={v.id}
                href={`/venues/${v.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.5fr 110px 120px 80px 80px 70px 70px",
                  columnGap: 16,
                  padding: "12px 20px",
                  borderBottom: "1px solid var(--rule)",
                  alignItems: "center",
                  cursor: "pointer",
                  color: "inherit",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--surface2, var(--surface))")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <MapPin size={14} color="var(--muted)" style={{ flexShrink: 0 }} />
                  <span
                    style={{
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--ink)",
                      letterSpacing: -0.2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {v.name}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    color: v.stateRegion ? "var(--ink)" : "var(--faint)",
                    letterSpacing: ".02em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {v.stateRegion ?? "—"}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    color: "var(--muted)",
                    letterSpacing: ".02em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {v.city}
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 12,
                    fontWeight: 500,
                    color: v.pastShowsCount > 0 ? "var(--ink)" : "var(--faint)",
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {v.pastShowsCount}
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 12,
                    fontWeight: 500,
                    color: v.futureShowsCount > 0 ? "var(--accent)" : "var(--faint)",
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {v.futureShowsCount}
                </div>
                <IdBadge
                  label="TM"
                  linked={Boolean(v.ticketmasterVenueId)}
                  color="var(--accent)"
                  tooltip={
                    v.ticketmasterVenueId
                      ? "Ticketmaster ID linked"
                      : "No Ticketmaster ID"
                  }
                />
                <IdBadge
                  label="GP"
                  linked={Boolean(v.googlePlaceId)}
                  color="var(--kind-concert)"
                  tooltip={
                    v.googlePlaceId
                      ? "Google Places ID linked"
                      : "No Google Places ID"
                  }
                />
              </Link>
            ))}

            <div
              style={{
                padding: "16px 20px",
                textAlign: "center",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--faint)",
                letterSpacing: ".1em",
              }}
            >
              {filtered.length} venue{filtered.length !== 1 ? "s" : ""} total
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IdBadge({
  label,
  linked,
  color,
  tooltip,
}: {
  label: string;
  linked: boolean;
  color: string;
  tooltip: string;
}) {
  return (
    <span
      title={tooltip}
      data-linked={linked}
      style={{
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 10,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        padding: "3px 8px",
        border: `1px solid ${linked ? color : "var(--faint)"}`,
        color: linked ? color : "var(--faint)",
        textAlign: "center",
        fontWeight: 500,
      }}
    >
      {label}
    </span>
  );
}

function CenteredMessage({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 300,
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
        color: tone === "error" ? "var(--kind-theatre)" : "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}
