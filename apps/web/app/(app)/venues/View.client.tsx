"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { MapPin, Search, Eye, Pencil, Ticket } from "lucide-react";
import { PaginationFooter } from "@/components/PaginationFooter";
import { SortHeader, type SortConfig } from "@/components/SortHeader";
import { useCompactMode } from "@/lib/useCompactMode";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { CenteredMessage, EmptyState, RemoteImage } from "@/components/design-system";

type SortField = "name" | "state" | "city" | "past" | "future";

const DEFAULT_DIR: Record<SortField, "asc" | "desc"> = {
  name: "asc",
  state: "asc",
  city: "asc",
  past: "desc",
  future: "desc",
};

function useWindowWidth() {
  const [width, setWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1440,
  );
  useEffect(() => {
    function onResize() {
      setWidth(window.innerWidth);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export default function VenuesView() {
  const router = useRouter();
  const [sort, setSort] = useState<SortConfig<SortField>>({
    field: "past",
    dir: "desc",
  });
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const compact = useCompactMode();
  const windowWidth = useWindowWidth();
  const isHalfWidth = windowWidth < 960;

  const PAGE_SIZE = compact ? 12 : 15;

  const [contextMenu, setContextMenu] = useState<{
    venueId: string;
    venueName: string;
    isFollowed: boolean;
    position: { x: number; y: number };
  } | null>(null);
  const [editingVenueId, setEditingVenueId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = trpc.venues.list.useQuery(undefined, {
    staleTime: 60_000,
  });
  const utils = trpc.useUtils();
  const renameMutation = trpc.venues.rename.useMutation({
    onSuccess: () => utils.venues.invalidate(),
  });
  const followMutation = trpc.venues.follow.useMutation({
    onSuccess: () => utils.venues.invalidate(),
  });
  const unfollowMutation = trpc.venues.unfollow.useMutation({
    onSuccess: () => utils.venues.invalidate(),
  });

  const toggleSort = useCallback((field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: DEFAULT_DIR[field] },
    );
    setCurrentPage(0);
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
      if (a == null) return 1;
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

  useEffect(() => {
    setCurrentPage(0);
  }, [search, sort.field, sort.dir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  function handleContextMenu(
    e: React.MouseEvent,
    venueId: string,
    venueName: string,
    isFollowed: boolean,
  ) {
    e.preventDefault();
    setContextMenu({
      venueId,
      venueName,
      isFollowed,
      position: { x: e.clientX, y: e.clientY },
    });
  }

  function startRename(venueId: string, currentName: string) {
    setEditingVenueId(venueId);
    setEditingName(currentName);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }

  async function commitRename() {
    if (!editingVenueId || !editingName.trim()) {
      setEditingVenueId(null);
      return;
    }
    await renameMutation.mutateAsync({
      venueId: editingVenueId,
      name: editingName.trim(),
    });
    setEditingVenueId(null);
  }

  function buildVenueMenuItems(
    venueId: string,
    venueName: string,
    isFollowed: boolean,
  ): ContextMenuItem[] {
    return [
      {
        label: "Rename",
        icon: <Pencil size={13} />,
        onClick: () => startRename(venueId, venueName),
      },
      {
        label: isFollowed ? "Unfollow" : "Follow",
        icon: <Eye size={13} />,
        onClick: () => {
          if (isFollowed) {
            unfollowMutation.mutate({ venueId });
          } else {
            followMutation.mutate({ venueId });
          }
        },
      },
    ];
  }

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* skeleton header */}
        <div style={{ padding: "16px 36px", borderBottom: "1px solid var(--rule)", flexShrink: 0, height: 52 }} />
        {/* skeleton filter bar */}
        <div style={{ padding: "10px 36px", borderBottom: "1px solid var(--rule)", flexShrink: 0, height: 44, background: "var(--surface)" }} />
        {/* skeleton table rows */}
        <div style={{ flex: 1, minHeight: 0, padding: "12px 36px 24px", overflow: "hidden" }}>
          <div style={{ background: "var(--surface)" }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} style={{ height: 40, borderBottom: "1px solid var(--rule)", background: "var(--surface)" }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return <CenteredMessage tone="error">Failed to load venues.</CenteredMessage>;
  }

  // Column layout: differs by responsive breakpoint
  const gridCols = isHalfWidth
    ? "minmax(120px,2fr) minmax(80px,1fr) 70px 70px 32px 32px 32px"
    : "minmax(120px,2fr) minmax(60px,0.7fr) minmax(80px,1fr) 70px 70px 32px 32px 32px";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: "16px 36px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--rule)" }}>
        <div>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase" }}>
            Places you&apos;ve been
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, color: "var(--ink)", letterSpacing: "-0.01em", lineHeight: 1.1, marginTop: 4 }}>
            Venues
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ padding: "11px 36px", display: "flex", alignItems: "center", gap: 18, background: "var(--surface)", borderBottom: "1px solid var(--rule)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: "1px solid var(--rule-strong)", minWidth: 220 }}>
          <Search size={12} color="var(--muted)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter venues, cities, states..."
            style={{ border: "none", background: "transparent", color: "var(--ink)", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, outline: "none", width: "100%", letterSpacing: ".02em" }}
          />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".04em" }}>
          {filtered.length} venue{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 36px 8px", display: "flex", alignItems: "baseline", gap: 14 }}>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: "var(--ink)", letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 500 }}>
            {search ? "Matching" : "All venues"} &middot; {filtered.length}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: "28px 36px" }}>
            <EmptyState
              kind="venues"
              title={search ? "No venue matches" : "Venues await"}
              body={search ? "Try another city or clear the filter." : "Venues populate from the shows you log."}
              action={
                search ? undefined : (
                  <button
                    type="button"
                    onClick={() => router.push("/add")}
                    style={{
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
                    }}
                  >
                    Add a Show
                  </button>
                )
              }
            />
          </div>
        ) : (
          <div style={{ margin: "4px 36px 0", background: "var(--surface)" }}>
            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: gridCols, columnGap: 20, padding: "10px 20px", borderBottom: "1px solid var(--rule)", fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase" }}>
              <SortHeader<SortField> field="name" label="Name" sort={sort} onToggle={toggleSort} />
              {!isHalfWidth && (
                <SortHeader<SortField> field="state" label="State" sort={sort} onToggle={toggleSort} />
              )}
              <SortHeader<SortField> field="city" label={isHalfWidth ? "City" : "City"} sort={sort} onToggle={toggleSort} />
              <SortHeader<SortField> field="past" label="Past" sort={sort} onToggle={toggleSort} align="center" />
              <SortHeader<SortField> field="future" label="Future" sort={sort} onToggle={toggleSort} align="center" />
              <div style={{ textAlign: "center" }}><Ticket size={10} /></div>
              <div style={{ textAlign: "center" }}><MapPin size={10} /></div>
              <div style={{ textAlign: "center" }}><Eye size={10} /></div>
            </div>

            {paged.map((v) => {
              const isEditing = editingVenueId === v.id;
              const cityDisplay = isHalfWidth && v.stateRegion
                ? `${v.city}, ${v.stateRegion}`
                : v.city;

              return (
                <div
                  key={v.id}
                  onContextMenu={(e) => handleContextMenu(e, v.id, v.name, v.isFollowed)}
                  style={{ position: "relative" }}
                >
                  {isEditing ? (
                    <div style={{ display: "grid", gridTemplateColumns: gridCols, columnGap: 20, padding: compact ? "5px 20px" : "10px 20px", borderBottom: "1px solid var(--rule)", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <MapPin size={14} color="var(--muted)" style={{ flexShrink: 0 }} />
                        <input
                          ref={editInputRef}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setEditingVenueId(null);
                          }}
                          onBlur={commitRename}
                          style={{ border: "none", borderBottom: "1px solid var(--accent)", background: "transparent", color: "var(--ink)", fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 14, fontWeight: 500, outline: "none", width: "100%" }}
                        />
                      </div>
                    </div>
                  ) : (
                    <Link
                      href={`/venues/${v.id}`}
                      style={{ display: "grid", gridTemplateColumns: gridCols, columnGap: 20, padding: compact ? "5px 20px" : "12px 20px", borderBottom: "1px solid var(--rule)", alignItems: "center", cursor: "pointer", color: "inherit", textDecoration: "none" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface2, var(--surface))")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <RemoteImage
                          src={v.photoUrl ? `/api/venue-photo/${v.id}` : null}
                          alt=""
                          kind="venue"
                          name={v.name}
                          aspect="square"
                          size="thumb"
                        />
                        <span style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 14, fontWeight: 500, color: "var(--ink)", letterSpacing: -0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {v.name}
                        </span>
                      </div>
                      {!isHalfWidth && (
                        <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: v.stateRegion ? "var(--ink)" : "var(--faint)", letterSpacing: ".02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {v.stateRegion ?? "—"}
                        </div>
                      )}
                      <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: "var(--muted)", letterSpacing: ".02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {cityDisplay}
                      </div>
                      <div style={{ textAlign: "center", fontFamily: "var(--font-geist-mono), monospace", fontSize: 12, fontWeight: 500, color: v.pastShowsCount > 0 ? "var(--ink)" : "var(--faint)", fontFeatureSettings: '"tnum"' }}>
                        {v.pastShowsCount}
                      </div>
                      <div style={{ textAlign: "center", fontFamily: "var(--font-geist-mono), monospace", fontSize: 12, fontWeight: 500, color: v.futureShowsCount > 0 ? "var(--accent)" : "var(--faint)", fontFeatureSettings: '"tnum"' }}>
                        {v.futureShowsCount}
                      </div>
                      <MetadataIcon linked={Boolean(v.ticketmasterVenueId)} label="Ticketmaster ID" Icon={Ticket} color="var(--accent)" />
                      <MetadataIcon linked={Boolean(v.googlePlaceId)} label="Google Places ID" Icon={MapPin} color="var(--kind-concert)" />
                      <span title={v.isFollowed ? "Following" : "Not following"} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        {v.isFollowed && <Eye size={13} color="var(--accent)" />}
                      </span>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination footer */}
        {filtered.length > 0 && (
          <PaginationFooter
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            totalItems={filtered.length}
            itemLabel="venues"
            onPageChange={setCurrentPage}
          />
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          items={buildVenueMenuItems(contextMenu.venueId, contextMenu.venueName, contextMenu.isFollowed)}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function MetadataIcon({
  linked,
  label,
  Icon,
  color,
}: {
  linked: boolean;
  label: string;
  Icon: typeof Ticket;
  color: string;
}) {
  return (
    <span
      title={linked ? `${label} linked` : `No ${label}`}
      data-linked={linked}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: linked ? color : "var(--faint)",
      }}
    >
      <Icon size={13} strokeWidth={2} />
    </span>
  );
}

