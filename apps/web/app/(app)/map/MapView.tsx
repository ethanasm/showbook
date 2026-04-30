"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { trpc } from "@/lib/trpc";
import { EmptyState, RemoteImage, type ShowKind } from "@/components/design-system";
import {
  ArrowUpRight,
  Plus,
  Filter,
  X,
  Music,
  Theater,
  Laugh,
  Tent,
} from "lucide-react";
import "./map.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KIND_COLORS: Record<string, string> = {
  concert: "var(--kind-concert)",
  theatre: "var(--kind-theatre)",
  comedy: "var(--kind-comedy)",
  festival: "var(--kind-festival)",
};

// Raw hex needed for CircleMarker (Leaflet doesn't support CSS vars)
const KIND_COLORS_HEX: Record<string, string> = {
  concert: "#3A86FF",
  theatre: "#E63946",
  comedy: "#9D4EDD",
  festival: "#2A9D8F",
};

const KIND_LABELS: Record<string, string> = {
  concert: "Concert",
  theatre: "Theatre",
  comedy: "Comedy",
  festival: "Festival",
};

const KIND_ICONS: Record<string, typeof Music> = {
  concert: Music,
  theatre: Theater,
  comedy: Laugh,
  festival: Tent,
};

const KINDS = [
  { k: "all", label: "All kinds" },
  { k: "concert", label: "Concert" },
  { k: "theatre", label: "Theatre" },
  { k: "comedy", label: "Comedy" },
  { k: "festival", label: "Festival" },
] as const;

const VIEW_PRESETS: { label: string; center: [number, number]; zoom: number }[] = [
  { label: "Bay Area", center: [37.7749, -122.4194], zoom: 9 },
  { label: "LA", center: [34.0522, -118.2437], zoom: 9 },
  { label: "Oregon", center: [44.0, -120.5], zoom: 7 },
  { label: "NYC", center: [40.7128, -74.006], zoom: 12 },
  { label: "World", center: [30.0, -20.0], zoom: 3 },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VenueShowData {
  id: string;
  kind: ShowKind;
  state: string;
  date: string;
  headliner: string;
  headlinerId: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
}

interface VenueGroup {
  venueId: string;
  name: string;
  city: string;
  photoUrl: string | null;
  latitude: number;
  longitude: number;
  shows: VenueShowData[];
  kindBreakdown: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dotRadius(count: number): number {
  return Math.max(4, Math.min(18, 3 + count * 1.2));
}

function getMostCommonKind(breakdown: Record<string, number>): string {
  let maxKind = "concert";
  let maxCount = 0;
  for (const [kind, count] of Object.entries(breakdown)) {
    if (count > maxCount) {
      maxCount = count;
      maxKind = kind;
    }
  }
  return maxKind;
}

function formatDateParts(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const month = d.toLocaleDateString("en-US", { month: "short" });
  const day = d.getDate();
  const year = d.getFullYear();
  return { month, day, year };
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${singular}s`;
}

function gradientLastWord(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) return <span className="gradient-emphasis">{name}</span>;
  const last = words.pop();
  return (
    <>
      {words.join(" ")} <span className="gradient-emphasis">{last}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// FitBounds component
// ---------------------------------------------------------------------------

function FitBounds({ venues }: { venues: VenueGroup[] }) {
  const map = useMap();

  useEffect(() => {
    if (venues.length === 0) return;
    if (venues.length === 1) {
      map.setView([venues[0].latitude, venues[0].longitude], 14);
      return;
    }
    const bounds = L.latLngBounds(
      venues.map((v) => [v.latitude, v.longitude] as [number, number])
    );
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [venues, map]);

  return null;
}

// ---------------------------------------------------------------------------
// MapViewChanger — used by view presets
// ---------------------------------------------------------------------------

function MapViewChanger({
  center,
  zoom,
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();

  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);

  return null;
}

// ---------------------------------------------------------------------------
// Top Bar
// ---------------------------------------------------------------------------

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function TopBar({ venues }: { venues: VenueGroup[] }) {
  const [showExport, setShowExport] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showExport) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowExport(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showExport]);

  const escapeCSV = (val: string) => `"${val.replace(/"/g, '""')}"`;

  const exportCSV = useCallback(() => {
    const headers = ["Date", "Kind", "Headliner", "Venue", "City", "Seat", "Price Paid", "Tickets", "State"];
    const rows = venues.flatMap((g) =>
      g.shows.map((s) => [s.date, s.kind, s.headliner, g.name, g.city, s.seat ?? "", s.pricePaid ?? "", String(s.ticketCount), s.state])
    );
    const csv = [headers, ...rows].map((r) => r.map((c) => escapeCSV(c)).join(",")).join("\n");
    downloadBlob(csv, "showbook-export.csv", "text/csv");
    setShowExport(false);
  }, [venues]);

  const exportJSON = useCallback(() => {
    const data = venues.flatMap((g) =>
      g.shows.map((s) => ({
        date: s.date, kind: s.kind, headliner: s.headliner, venue: g.name, city: g.city,
        latitude: g.latitude, longitude: g.longitude,
        seat: s.seat, pricePaid: s.pricePaid, ticketCount: s.ticketCount, state: s.state,
      }))
    );
    downloadBlob(JSON.stringify(data, null, 2), "showbook-export.json", "application/json");
    setShowExport(false);
  }, [venues]);

  return (
    <div className="map-topbar">
      <div>
        <div className="map-topbar__subtitle">Map &middot; geographic view</div>
        <div className="map-topbar__title">Where you&apos;ve been</div>
      </div>
      <div className="map-topbar__actions">
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button className="map-topbar__btn-outline" type="button" onClick={() => setShowExport((v) => !v)}>
            <ArrowUpRight size={12} />
            Export
          </button>
          {showExport && (
            <div style={{
              position: "absolute", top: "100%", right: 0, marginTop: 4,
              background: "var(--surface)", border: "1px solid var(--rule-strong)",
              zIndex: 10, minWidth: 160,
            }}>
              <button type="button" onClick={exportCSV} style={{
                display: "block", width: "100%", padding: "10px 14px", background: "none", border: "none",
                color: "var(--ink)", fontFamily: "var(--font-geist-mono)", fontSize: 11,
                textAlign: "left", cursor: "pointer", borderBottom: "1px solid var(--rule)",
              }}>
                Export as CSV
              </button>
              <button type="button" onClick={exportJSON} style={{
                display: "block", width: "100%", padding: "10px 14px", background: "none", border: "none",
                color: "var(--ink)", fontFamily: "var(--font-geist-mono)", fontSize: 11,
                textAlign: "left", cursor: "pointer",
              }}>
                Export as JSON
              </button>
            </div>
          )}
        </div>
        <button className="map-topbar__btn-solid" type="button">
          <Plus size={12} />
          Add a show
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter Bar
// ---------------------------------------------------------------------------

function FilterBar({
  year,
  setYear,
  kind,
  setKind,
  venueCount,
  showCount,
  years,
}: {
  year: string;
  setYear: (y: string) => void;
  kind: string;
  setKind: (k: string) => void;
  venueCount: number;
  showCount: number;
  years: string[];
}) {
  return (
    <div className="map-filterbar">
      <div className="map-filterbar__viewing">
        <div className="map-filterbar__viewing-label">Viewing</div>
        <div className="map-filterbar__viewing-text">
          All shows on the map
        </div>
      </div>

      <div className="map-filterbar__years">
        {years.map((y) => (
          <button
            key={y}
            className={`map-filterbar__year-btn ${
              y === year ? "map-filterbar__year-btn--active" : ""
            }`}
            onClick={() => setYear(y)}
            type="button"
          >
            {y}
          </button>
        ))}
      </div>

      <div className="map-filterbar__kinds">
        {KINDS.map(({ k, label }) => {
          const active = k === kind;
          const KindIcon = k !== "all" ? KIND_ICONS[k] : null;
          let activeClass = "";
          if (active) {
            activeClass =
              k === "all"
                ? "map-filterbar__kind-btn--active-all"
                : `map-filterbar__kind-btn--active-${k}`;
          }
          return (
            <button
              key={k}
              className={`map-filterbar__kind-btn ${activeClass}`}
              onClick={() => setKind(k)}
              type="button"
            >
              {KindIcon && <KindIcon size={12} />}
              {label}
            </button>
          );
        })}
      </div>

      <div className="map-filterbar__spacer" />

      <div className="map-filterbar__counts">
        <Filter size={12} />
        <span>
          {venueCount} venues &middot; {showCount} shows
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map Overlays
// ---------------------------------------------------------------------------

function MapLegend() {
  const sizes = [1, 3, 6, 12];
  return (
    <div className="map-overlay-legend">
      <div className="map-overlay-legend__title">
        dot size &middot; # of shows
      </div>
      <div className="map-overlay-legend__dots">
        {sizes.map((n) => {
          const d = dotRadius(n) * 2;
          return (
            <div key={n} className="map-overlay-legend__dot-item">
              <div
                className="map-overlay-legend__dot"
                style={{ width: d, height: d }}
              />
              <div className="map-overlay-legend__dot-label">{n}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ViewToggle({
  activeView,
  setActiveView,
}: {
  activeView: number;
  setActiveView: (i: number) => void;
}) {
  return (
    <div className="map-overlay-viewtoggle">
      {VIEW_PRESETS.map((v, i) => (
        <button
          key={v.label}
          className={`map-overlay-viewtoggle__btn ${
            i === activeView ? "map-overlay-viewtoggle__btn--active" : ""
          }`}
          onClick={() => setActiveView(i)}
          type="button"
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function StatsOverlay({
  venueCount,
  showCount,
}: {
  venueCount: number;
  showCount: number;
}) {
  return (
    <div className="map-overlay-stats">
      <div>
        <div className="map-overlay-stats__value">{venueCount}</div>
        <div className="map-overlay-stats__label">venues</div>
      </div>
      <div className="map-overlay-stats__divider" />
      <div>
        <div className="map-overlay-stats__value">{showCount}</div>
        <div className="map-overlay-stats__label">shows</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Venue Inspector Panel
// ---------------------------------------------------------------------------

function VenueInspector({
  venue,
  onClose,
}: {
  venue: VenueGroup;
  onClose: () => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: followedVenues } = trpc.venues.followed.useQuery();

  const isFollowed = useMemo(
    () => followedVenues?.some((v) => v.id === venue.venueId) ?? false,
    [followedVenues, venue.venueId]
  );

  const followMutation = trpc.venues.follow.useMutation({
    onSuccess: () => {
      utils.venues.followed.invalidate();
      utils.discover.followedFeed.invalidate();
      utils.discover.nearbyFeed.invalidate();
    },
  });

  const unfollowMutation = trpc.venues.unfollow.useMutation({
    onSuccess: () => {
      utils.venues.followed.invalidate();
      utils.discover.followedFeed.invalidate();
      utils.discover.nearbyFeed.invalidate();
    },
  });

  const handleFollowToggle = useCallback(() => {
    if (isFollowed) {
      unfollowMutation.mutate({ venueId: venue.venueId });
    } else {
      followMutation.mutate({ venueId: venue.venueId });
    }
  }, [isFollowed, venue.venueId, followMutation, unfollowMutation]);

  const isMutating = followMutation.isPending || unfollowMutation.isPending;

  const uniqueArtists = useMemo(() => {
    const set = new Set(venue.shows.map((s) => s.headliner));
    return set.size;
  }, [venue.shows]);

  const totalSpent = useMemo(() => {
    return venue.shows.reduce((sum, s) => {
      return sum + (s.pricePaid ? parseFloat(s.pricePaid) : 0);
    }, 0);
  }, [venue.shows]);

  const firstYear = useMemo(() => {
    if (venue.shows.length === 0) return "";
    const sorted = [...venue.shows].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    return new Date(sorted[0].date + "T00:00:00").getFullYear().toString();
  }, [venue.shows]);

  return (
    <div className="venue-inspector">
      <div className="venue-inspector__photo">
        <RemoteImage
          src={venue.photoUrl ? `/api/venue-photo/${venue.venueId}` : null}
          alt={`${venue.name} venue photo`}
          kind="venue"
          name={venue.name}
          aspect="16/9"
          size="hero"
        />
      </div>

      {/* Header */}
      <div className="venue-inspector__header">
        <div className="venue-inspector__header-top">
          <div className="venue-inspector__label">
            <span className="pulse-dot" />
            Selected venue
          </div>
          <button
            className="venue-inspector__close"
            onClick={onClose}
            type="button"
            aria-label="Close panel"
          >
            <X size={16} />
          </button>
        </div>
        <h2 className="venue-inspector__name">
          <Link href={`/venues/${venue.venueId}`} className="venue-inspector__name-link">
            {gradientLastWord(venue.name)}
          </Link>
        </h2>
        <div className="venue-inspector__neighborhood">{venue.city}</div>
        <div className="venue-inspector__coords">
          {venue.latitude.toFixed(4)}&deg; N &middot;{" "}
          {Math.abs(venue.longitude).toFixed(4)}&deg;{" "}
          {venue.longitude >= 0 ? "E" : "W"}
        </div>
      </div>

      {/* Stats strip */}
      <div className="venue-inspector__stats">
        <div className="venue-inspector__stat">
          <div className="venue-inspector__stat-value">
            {venue.shows.length}
          </div>
          <div className="venue-inspector__stat-label">Shows</div>
          <div className="venue-inspector__stat-sub">since {firstYear}</div>
        </div>
        <div className="venue-inspector__stat">
          <div className="venue-inspector__stat-value">{uniqueArtists}</div>
          <div className="venue-inspector__stat-label">Artists</div>
          <div className="venue-inspector__stat-sub">unique</div>
        </div>
        <div className="venue-inspector__stat">
          <div className="venue-inspector__stat-value">
            ${Math.round(totalSpent).toLocaleString()}
          </div>
          <div className="venue-inspector__stat-label">Spent</div>
          <div className="venue-inspector__stat-sub">lifetime</div>
        </div>
      </div>

      {/* Kind mix */}
      <div className="venue-inspector__kindmix">
        <div className="venue-inspector__kindmix-label">Kind mix</div>
        {Object.entries(venue.kindBreakdown).map(([k, count]) => {
          const KindIcon = KIND_ICONS[k];
          const color = KIND_COLORS[k] ?? "var(--muted)";
          return (
            <div
              key={k}
              className="venue-inspector__kindmix-chip"
              style={{ color }}
            >
              {KindIcon && <KindIcon size={12} />}
              {KIND_LABELS[k] ?? k} &middot; {count}
            </div>
          );
        })}
      </div>

      {/* All visits header */}
      <div className="venue-inspector__visits-header">
        <div className="venue-inspector__visits-title">All visits</div>
        <div className="venue-inspector__visits-count">
          {venue.shows.length} &middot; newest first
        </div>
      </div>

      {/* Visits list */}
      <div className="venue-inspector__visits-list">
        {venue.shows.map((show) => {
          const { month, day, year } = formatDateParts(show.date);
          return (
            <div key={show.id} className="venue-inspector__visit-row">
              <div>
                <div className="venue-inspector__visit-date-display">
                  {month} {day}
                </div>
                <div className="venue-inspector__visit-date-year">{year}</div>
              </div>
              <div className="venue-inspector__visit-info">
                <div className="venue-inspector__visit-artist">
                  {show.headlinerId ? (
                    <Link
                      href={`/artists/${show.headlinerId}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                    >
                      {show.headliner}
                    </Link>
                  ) : (
                    show.headliner
                  )}
                </div>
                <div className="venue-inspector__visit-seat">
                  {show.seat ? show.seat.toLowerCase() : "general"}
                </div>
              </div>
              <div className="venue-inspector__visit-price">
                {show.pricePaid ? `$${Math.round(parseFloat(show.pricePaid) / (show.ticketCount || 1))}/ea` : "--"}
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA buttons */}
      <div className="venue-inspector__cta">
        <button
          className={`venue-inspector__cta-follow ${
            isFollowed ? "venue-inspector__cta-follow--following" : ""
          }`}
          onClick={handleFollowToggle}
          disabled={isMutating}
          type="button"
        >
          <Plus size={13} />
          {isMutating ? "..." : isFollowed ? "Following" : "Follow"}
        </button>
        <button
          className="venue-inspector__cta-solid"
          type="button"
          onClick={() => {
            const params = new URLSearchParams({
              timeframe: "past",
              venueName: venue.name,
              venueCity: venue.city,
            });
            router.push(`/add?${params.toString()}`);
          }}
        >
          <Plus size={13} />
          Log a visit
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main MapView
// ---------------------------------------------------------------------------

// Deep-link flyTo controller: flies to a venue when it becomes available
function FlyToVenue({ venueId, venues }: { venueId: string | null; venues: VenueGroup[] }) {
  const map = useMap();
  const didFly = useRef(false);

  useEffect(() => {
    if (!venueId || didFly.current) return;
    const venue = venues.find((v) => v.venueId === venueId);
    if (!venue) return;
    map.flyTo([venue.latitude, venue.longitude], 14);
    didFly.current = true;
  }, [venueId, venues, map]);

  return null;
}

export default function MapView() {
  const searchParams = useSearchParams();
  const deepLinkVenueId = searchParams.get("venue");
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(deepLinkVenueId);
  const [yearFilter, setYearFilter] = useState("All-time");
  const [kindFilter, setKindFilter] = useState("all");
  const [activeView, setActiveView] = useState<number | null>(null);

  const { data: shows, isLoading } = trpc.shows.listForMap.useQuery();

  const yearOptions = useMemo(() => {
    if (!shows) return ["All-time"];
    const yearSet = new Set<number>();
    for (const show of shows) {
      if (show.date) {
        yearSet.add(new Date(show.date + "T00:00:00").getFullYear());
      }
    }
    const sorted = Array.from(yearSet).sort((a, b) => b - a);
    return ["All-time", ...sorted.map(String)];
  }, [shows]);

  // Build venue groups from shows
  const venueGroups = useMemo(() => {
    if (!shows) return [];

    const grouped = new Map<string, VenueGroup>();

    for (const show of shows) {
      const venue = show.venue;
      if (!venue || venue.latitude == null || venue.longitude == null) continue;
      // Watching shows from a multi-night run can have no committed date yet
      // — nothing to plot until the user picks a performance.
      if (!show.date) continue;

      const existing = grouped.get(venue.id);
      const showData: VenueShowData = {
        id: show.id,
        kind: show.kind as ShowKind,
        state: show.state,
        date: show.date,
        headliner: show.headlinerName ?? "Unknown Artist",
        headlinerId: show.headlinerId,
        seat: show.seat,
        pricePaid: show.pricePaid,
        ticketCount: show.ticketCount ?? 1,
      };

      if (existing) {
        existing.shows.push(showData);
        existing.kindBreakdown[show.kind] =
          (existing.kindBreakdown[show.kind] ?? 0) + 1;
      } else {
        grouped.set(venue.id, {
          venueId: venue.id,
          name: venue.name,
          city: venue.city,
          photoUrl: venue.photoUrl,
          latitude: venue.latitude,
          longitude: venue.longitude,
          shows: [showData],
          kindBreakdown: { [show.kind]: 1 },
        });
      }
    }

    return Array.from(grouped.values());
  }, [shows]);

  // Apply filters
  const filteredVenues = useMemo(() => {
    return venueGroups
      .map((venue) => {
        let filtered = venue.shows;

        // Year filter
        if (yearFilter !== "All-time") {
          const yr = parseInt(yearFilter);
          filtered = filtered.filter((s) => {
            const showYear = new Date(s.date + "T00:00:00").getFullYear();
            return showYear === yr;
          });
        }

        // Kind filter
        if (kindFilter !== "all") {
          filtered = filtered.filter((s) => s.kind === kindFilter);
        }

        if (filtered.length === 0) return null;

        // Rebuild kindBreakdown for filtered shows
        const kindBreakdown: Record<string, number> = {};
        for (const s of filtered) {
          kindBreakdown[s.kind] = (kindBreakdown[s.kind] ?? 0) + 1;
        }

        return {
          ...venue,
          shows: filtered,
          kindBreakdown,
        };
      })
      .filter(Boolean) as VenueGroup[];
  }, [venueGroups, yearFilter, kindFilter]);

  const totalShowCount = useMemo(
    () => filteredVenues.reduce((sum, v) => sum + v.shows.length, 0),
    [filteredVenues]
  );

  const unmappedCount = useMemo(() => {
    if (!shows) return 0;
    return shows.filter(
      (s) =>
        !s.venue?.latitude ||
        !s.venue?.longitude ||
        !s.venue?.stateRegion,
    ).length;
  }, [shows]);

  const backfillCoordinates = trpc.venues.backfillCoordinates.useMutation();
  const utils = trpc.useUtils();
  const [backfilling, setBackfilling] = useState(false);

  const selectedVenue = useMemo(
    () => filteredVenues.find((v) => v.venueId === selectedVenueId) ?? null,
    [filteredVenues, selectedVenueId]
  );

  const defaultCenter: [number, number] = useMemo(() => {
    if (filteredVenues.length === 0) return [40.7128, -74.006];
    const avgLat =
      filteredVenues.reduce((sum, v) => sum + v.latitude, 0) /
      filteredVenues.length;
    const avgLng =
      filteredVenues.reduce((sum, v) => sum + v.longitude, 0) /
      filteredVenues.length;
    return [avgLat, avgLng];
  }, [filteredVenues]);

  if (isLoading) {
    return (
      <div className="map-loading">
        <p>Loading your shows...</p>
      </div>
    );
  }

  if (venueGroups.length === 0) {
    return (
      <div className="map-empty">
        <EmptyState
          kind="map"
          title="No mapped venues"
          body={unmappedCount > 0 ? "Some venues need coordinates before they can appear here." : "Add a show with a venue to see it on the map."}
          action={
            unmappedCount > 0 ? (
              <button
                type="button"
                className="map-backfill-banner__btn"
                disabled={backfilling}
                onClick={async () => {
                  setBackfilling(true);
                  try {
                    await backfillCoordinates.mutateAsync();
                    await utils.shows.invalidate();
                  } finally {
                    setBackfilling(false);
                  }
                }}
              >
                {backfilling ? "Geocoding..." : `Geocode ${unmappedCount} venue${unmappedCount !== 1 ? "s" : ""}`}
              </button>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className="map-page">
      <TopBar venues={filteredVenues} />
      <FilterBar
        year={yearFilter}
        setYear={setYearFilter}
        kind={kindFilter}
        setKind={setKindFilter}
        venueCount={filteredVenues.length}
        showCount={totalShowCount}
        years={yearOptions}
      />

      {unmappedCount > 0 && (
        <div className="map-backfill-banner">
          <span>
            {unmappedCount} show{unmappedCount !== 1 ? "s" : ""} at venues
            without coordinates
          </span>
          <button
            type="button"
            disabled={backfilling}
            onClick={async () => {
              setBackfilling(true);
              try {
                await backfillCoordinates.mutateAsync();
                await utils.shows.invalidate();
              } finally {
                setBackfilling(false);
              }
            }}
          >
            {backfilling ? "Geocoding..." : "Geocode now"}
          </button>
        </div>
      )}

      <div className="map-body">
        {/* Map area */}
        <div className="map-area">
          <MapContainer
            center={defaultCenter}
            zoom={12}
            className="map-leaflet"
            zoomControl={true}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors &copy; CARTO"
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            {activeView !== null ? (
              <MapViewChanger
                center={VIEW_PRESETS[activeView].center}
                zoom={VIEW_PRESETS[activeView].zoom}
              />
            ) : (
              <FitBounds venues={filteredVenues} />
            )}
            {deepLinkVenueId && (
              <FlyToVenue venueId={deepLinkVenueId} venues={filteredVenues} />
            )}
            {filteredVenues.map((venue) => {
              const count = venue.shows.length;
              const r = dotRadius(count);
              const dominantKind = getMostCommonKind(venue.kindBreakdown);
              const color = KIND_COLORS_HEX[dominantKind] ?? "#3A86FF";
              const isSelected = venue.venueId === selectedVenueId;

              return (
                <CircleMarker
                  key={venue.venueId}
                  center={[venue.latitude, venue.longitude]}
                  radius={r}
                  pathOptions={{
                    fillColor: color,
                    fillOpacity: isSelected ? 1.0 : 0.85,
                    color: isSelected ? "#F5F5F3" : color,
                    weight: isSelected ? 1.5 : 0,
                    opacity: 1,
                  }}
                  eventHandlers={{
                    click: () => setSelectedVenueId(venue.venueId),
                  }}
                >
                  {count >= 4 && (
                    <Tooltip
                      permanent
                      direction="center"
                      className="map-circle-count"
                    >
                      <span
                        style={{
                          fontSize: r > 10 ? 10 : 9,
                          fontWeight: 600,
                          color: "#0C0C0C",
                          fontFamily:
                            'var(--font-geist-mono, "Geist Mono", monospace)',
                        }}
                      >
                        {count}
                      </span>
                    </Tooltip>
                  )}
                </CircleMarker>
              );
            })}
          </MapContainer>

          {/* Overlays */}
          <MapLegend />
          <ViewToggle activeView={activeView ?? -1} setActiveView={setActiveView} />
          <StatsOverlay
            venueCount={filteredVenues.length}
            showCount={totalShowCount}
          />
        </div>

        {/* Inspector panel */}
        {selectedVenue && (
          <VenueInspector
            venue={selectedVenue}
            onClose={() => setSelectedVenueId(null)}
          />
        )}
      </div>
    </div>
  );
}
