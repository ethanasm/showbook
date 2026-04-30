"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Search, Eye, Pencil, Trash2, Ticket, Check, ChevronLeft, ChevronRight, Music2 } from "lucide-react";
import { SortHeader, type SortConfig } from "@/components/SortHeader";
import { useCompactMode } from "@/lib/useCompactMode";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { EmptyState, RemoteImage } from "@/components/design-system";

type SortField = "name" | "shows" | "past" | "future" | "firstSeen" | "lastSeen";

const DEFAULT_DIR: Record<SortField, "asc" | "desc"> = {
  name: "asc",
  shows: "desc",
  past: "desc",
  future: "desc",
  firstSeen: "desc",
  lastSeen: "desc",
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

export default function ArtistsPage() {
  const [sort, setSort] = useState<SortConfig<SortField>>({
    field: "lastSeen",
    dir: "desc",
  });
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const compact = useCompactMode();
  const windowWidth = useWindowWidth();
  const isHalfWidth = windowWidth < 960;

  const PAGE_SIZE = compact ? 12 : 15;

  const [contextMenu, setContextMenu] = useState<{
    artistId: string;
    artistName: string;
    isFollowed: boolean;
    position: { x: number; y: number };
  } | null>(null);

  const { data: artists, isLoading, error } = trpc.performers.list.useQuery(undefined, {
    staleTime: 60_000,
  });
  const { data: showsData } = trpc.shows.list.useQuery({}, { staleTime: 60_000 });

  const utils = trpc.useUtils();
  const renameMutation = trpc.performers.rename.useMutation({
    onSuccess: () => utils.performers.invalidate(),
  });
  const deleteMutation = trpc.performers.delete.useMutation({
    onSuccess: () => {
      utils.performers.invalidate();
      utils.shows.invalidate();
    },
  });
  const followMutation = trpc.performers.follow.useMutation({
    onSuccess: () => utils.performers.invalidate(),
  });
  const unfollowMutation = trpc.performers.unfollow.useMutation({
    onSuccess: () => utils.performers.invalidate(),
  });
  const updateStateMutation = trpc.shows.updateState.useMutation({
    onSuccess: () => {
      utils.shows.invalidate();
      utils.performers.invalidate();
    },
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
    let result = artists ?? [];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((a) => a.name.toLowerCase().includes(q));
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
        case "shows":
          return (a.showCount - b.showCount) * flip;
        case "past":
          return (a.pastShowsCount - b.pastShowsCount) * flip;
        case "future":
          return (a.futureShowsCount - b.futureShowsCount) * flip;
        case "firstSeen":
          return cmpStr(a.firstSeen, b.firstSeen) * flip;
        case "lastSeen":
          return cmpStr(a.lastSeen, b.lastSeen) * flip;
      }
    });

    return result;
  }, [artists, search, sort]);

  useEffect(() => {
    setCurrentPage(0);
  }, [search, sort.field, sort.dir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, artistId: string, artistName: string, isFollowed: boolean) => {
      e.preventDefault();
      setContextMenu({ artistId, artistName, isFollowed, position: { x: e.clientX, y: e.clientY } });
    },
    [],
  );

  function buildArtistMenuItems(
    artistId: string,
    artistName: string,
    isFollowed: boolean,
  ): ContextMenuItem[] {
    // Find this artist's most recent ticketed/watching show
    const artistShows = (showsData ?? []).filter((show) =>
      (show as { showPerformers: { performer: { id: string } }[] }).showPerformers?.some(
        (sp) => sp.performer.id === artistId,
      ),
    ) as Array<{
      id: string;
      state: string;
      date: string;
      showPerformers: { performer: { id: string } }[];
    }>;

    const ticketedShow = artistShows
      .filter((s) => s.state === "ticketed")
      .sort((a, b) => b.date.localeCompare(a.date))[0];

    const watchingShow = artistShows
      .filter((s) => s.state === "watching")
      .sort((a, b) => b.date.localeCompare(a.date))[0];

    const items: ContextMenuItem[] = [
      {
        label: "Rename",
        icon: <Pencil size={13} />,
        onClick: () => {
          const newName = prompt(`Rename "${artistName}":`, artistName);
          if (newName && newName.trim()) {
            renameMutation.mutate({ performerId: artistId, name: newName.trim() });
          }
        },
      },
      {
        label: isFollowed ? "Unfollow" : "Follow",
        icon: <Eye size={13} />,
        onClick: () => {
          if (isFollowed) {
            unfollowMutation.mutate({ performerId: artistId });
          } else {
            followMutation.mutate({ performerId: artistId });
          }
        },
      },
    ];

    if (watchingShow) {
      items.push({
        label: "Got tickets",
        icon: <Ticket size={13} />,
        onClick: () => {
          updateStateMutation.mutate({ showId: watchingShow.id, newState: "ticketed" });
        },
      });
    }

    if (ticketedShow) {
      items.push({
        label: "Mark as attended",
        icon: <Check size={13} />,
        onClick: () => {
          updateStateMutation.mutate({ showId: ticketedShow.id, newState: "past" });
        },
      });
    }

    items.push({
      label: "Delete artist",
      icon: <Trash2 size={13} />,
      onClick: () => {
        if (confirm(`Remove "${artistName}" from all your shows? This cannot be undone.`)) {
          deleteMutation.mutate({ performerId: artistId });
        }
      },
      danger: true,
    });

    return items;
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
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} style={{ height: 40, borderBottom: "1px solid var(--rule)", background: "var(--surface)" }} />
            ))}
          </div>
        </div>
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

  // Column layout: name | shows | past | future | first seen | last seen | metadata | follow
  const gridCols = isHalfWidth
    ? "minmax(140px,2fr) 58px 52px 58px minmax(98px,0.9fr) 32px 32px 32px"
    : "minmax(180px,2.4fr) 62px 54px 62px minmax(106px,0.9fr) minmax(106px,0.9fr) 32px 32px 32px";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: "16px 36px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--rule)" }}>
        <div>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase" }}>
            Performers you&apos;ve seen live
          </div>
          <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 26, fontWeight: 600, color: "var(--ink)", letterSpacing: -0.9, marginTop: 4 }}>
            Artists
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ padding: "11px 36px", display: "flex", alignItems: "center", gap: 18, background: "var(--surface)", borderBottom: "1px solid var(--rule)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: "1px solid var(--rule-strong)", minWidth: 200 }}>
          <Search size={12} color="var(--muted)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter artists..."
            style={{ border: "none", background: "transparent", color: "var(--ink)", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, outline: "none", width: "100%", letterSpacing: ".02em" }}
          />
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".04em" }}>
          {filtered.length} artist{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)" }}>
        <div style={{ padding: "18px 36px 8px", display: "flex", alignItems: "baseline", gap: 14 }}>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: "var(--ink)", letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 500 }}>
            {search ? "Matching" : "All artists"} &middot; {filtered.length}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: "28px 36px" }}>
            <EmptyState
              kind="artists"
              title={search ? "No artist matches" : "Artists await"}
              body={search ? "Try another spelling or clear the filter." : "Artists populate from the shows you log."}
            />
          </div>
        ) : (
          <div style={{ margin: "4px 36px 0", background: "var(--surface)" }}>
            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: gridCols, columnGap: 14, padding: "10px 20px", borderBottom: "1px solid var(--rule)", fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", letterSpacing: ".12em", textTransform: "uppercase" }}>
              <SortHeader<SortField> field="name" label="Name" sort={sort} onToggle={toggleSort} />
              <SortHeader<SortField> field="shows" label="Shows" sort={sort} onToggle={toggleSort} align="center" />
              <SortHeader<SortField> field="past" label="Past" sort={sort} onToggle={toggleSort} align="center" />
              <SortHeader<SortField> field="future" label="Future" sort={sort} onToggle={toggleSort} align="center" />
              {!isHalfWidth && <SortHeader<SortField> field="firstSeen" label="First Seen" sort={sort} onToggle={toggleSort} />}
              <SortHeader<SortField> field="lastSeen" label="Last Seen" sort={sort} onToggle={toggleSort} />
              <div style={{ textAlign: "center" }}><Ticket size={10} /></div>
              <div style={{ textAlign: "center" }}><Music2 size={10} /></div>
              <div style={{ textAlign: "center" }}><Eye size={10} /></div>
            </div>

            {paged.map((artist) => (
              <div
                key={artist.id}
                onContextMenu={(e) => handleContextMenu(e, artist.id, artist.name, artist.isFollowed)}
              >
                <Link
                  href={`/artists/${artist.id}`}
                  style={{ display: "grid", gridTemplateColumns: gridCols, columnGap: 14, padding: compact ? "5px 20px" : "12px 20px", borderBottom: "1px solid var(--rule)", alignItems: "center", cursor: "pointer", color: "inherit", textDecoration: "none" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface2, var(--surface))")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <RemoteImage
                      src={artist.imageUrl}
                      alt=""
                      kind="artists"
                      name={artist.name}
                      aspect="square"
                      size="thumb"
                    />
                    <span style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 14, fontWeight: 500, color: "var(--ink)", letterSpacing: -0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {artist.name}
                    </span>
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "var(--font-geist-mono), monospace", fontSize: 12, fontWeight: 500, color: "var(--ink)", fontFeatureSettings: '"tnum"' }}>
                    {artist.showCount}&times;
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "var(--font-geist-mono), monospace", fontSize: 12, fontWeight: 500, color: artist.pastShowsCount > 0 ? "var(--ink)" : "var(--faint)", fontFeatureSettings: '"tnum"' }}>
                    {artist.pastShowsCount}
                  </div>
                  <div style={{ textAlign: "center", fontFamily: "var(--font-geist-mono), monospace", fontSize: 12, fontWeight: 500, color: artist.futureShowsCount > 0 ? "var(--accent)" : "var(--faint)", fontFeatureSettings: '"tnum"' }}>
                    {artist.futureShowsCount}
                  </div>
                  {!isHalfWidth && (
                    <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: "var(--muted)", letterSpacing: ".02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {artist.firstSeen ? formatDate(artist.firstSeen) : "—"}
                    </div>
                  )}
                  <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, color: "var(--muted)", letterSpacing: ".02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {artist.lastSeen ? formatDate(artist.lastSeen) : "—"}
                  </div>
                  <MetadataIcon linked={Boolean(artist.ticketmasterAttractionId)} label="Ticketmaster ID" Icon={Ticket} color="var(--accent)" />
                  <MetadataIcon linked={Boolean(artist.musicbrainzId)} label="MusicBrainz ID" Icon={Music2} color="var(--kind-concert)" />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }} title={artist.isFollowed ? "Following" : "Not following"}>
                    {artist.isFollowed && <Eye size={13} color="var(--accent)" />}
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* Pagination footer */}
        {filtered.length > 0 && (
          <div style={{ margin: "0 36px 36px", background: "var(--surface)", borderTop: "1px solid var(--rule)", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              style={{ display: "flex", alignItems: "center", gap: 4, border: "1px solid var(--rule-strong)", background: "transparent", color: currentPage === 0 ? "var(--faint)" : "var(--ink)", padding: "5px 11px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, cursor: currentPage === 0 ? "not-allowed" : "pointer", opacity: currentPage === 0 ? 0.4 : 1 }}
              data-testid="pagination-prev"
            >
              <ChevronLeft size={12} /> Prev
            </button>
            <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".06em" }}>
              {filtered.length === 0
                ? "0 artists"
                : `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              style={{ display: "flex", alignItems: "center", gap: 4, border: "1px solid var(--rule-strong)", background: "transparent", color: currentPage >= totalPages - 1 ? "var(--faint)" : "var(--ink)", padding: "5px 11px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, cursor: currentPage >= totalPages - 1 ? "not-allowed" : "pointer", opacity: currentPage >= totalPages - 1 ? 0.4 : 1 }}
              data-testid="pagination-next"
            >
              Next <ChevronRight size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          items={buildArtistMenuItems(contextMenu.artistId, contextMenu.artistName, contextMenu.isFollowed)}
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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
