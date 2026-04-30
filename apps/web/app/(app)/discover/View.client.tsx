"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  SortHeader,
  type SortConfig as SortConfigBase,
} from "@/components/SortHeader";
import { EmptyState, type ShowKind } from "@/components/design-system";
import {
  Music,
  Eye,
  Check,
  ArrowUpRight,
  Plus,
  Search,
  X,
  CalendarPlus,
} from "lucide-react";
import {
  groupAnnouncementsByRegion,
  groupVenuesByRegion,
} from "./region-helpers";
import { DISCOVER_KIND_ICONS as KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";
import { ContextMenu } from "@/components/ContextMenu";
import { VenueSearchModal } from "@/components/VenueSearchModal";
import { RegionSearchModal } from "@/components/RegionSearchModal";
import "./discover.css";

type DiscoverKind = ShowKind | "sports";
type DiscoverSortField =
  | "showDate"
  | "kind"
  | "venue"
  | "headliner"
  | "onSaleDate"
  | "onSaleStatus";
type DiscoverSortConfig = SortConfigBase<DiscoverSortField>;

// ---------------------------------------------------------------------------
// Types inferred from the tRPC router
// ---------------------------------------------------------------------------

type Announcement = {
  id: string;
  venueId: string;
  kind: DiscoverKind;
  headliner: string;
  headlinerPerformerId: string | null;
  support: string[] | null;
  productionName: string | null;
  showDate: string;
  runStartDate: string | null;
  runEndDate: string | null;
  performanceDates: string[] | null;
  onSaleDate: string | null;
  onSaleStatus: "announced" | "on_sale" | "sold_out";
  source: string;
  ticketUrl: string | null;
  venue: {
    id: string;
    name: string;
    city: string;
  };
  reason?: string;
  regionId?: string | null;
  regionCityName?: string | null;
  regionRadiusMiles?: number | null;
};

function isRun(a: Announcement): boolean {
  return (
    !!a.runStartDate &&
    !!a.runEndDate &&
    a.runStartDate !== a.runEndDate
  );
}

function formatRunRange(start: string, end: string): string {
  const fmt = (s: string) => {
    const d = new Date(s + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REASON_LABELS: Record<string, string> = {
  "followed-venue": "followed venue",
  nearby: "followed region",
  "tracked-artist": "tracked artist",
};

const ON_SALE_STATUS_LABELS: Record<string, string> = {
  announced: "announced",
  on_sale: "on sale",
  sold_out: "sold out",
};

const DISCOVER_KIND_ORDER: Record<DiscoverKind, number> = {
  concert: 0,
  theatre: 1,
  comedy: 2,
  festival: 3,
  sports: 4,
};

const ON_SALE_STATUS_ORDER: Record<Announcement["onSaleStatus"], number> = {
  announced: 0,
  on_sale: 1,
  sold_out: 2,
};

const DISCOVER_DEFAULT_SORT: DiscoverSortConfig = {
  field: "showDate",
  dir: "asc",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatShowDateShort(dateStr: string): {
  month: string;
  day: string;
  year: string;
  dow: string;
} {
  const d = new Date(dateStr + "T00:00:00");
  const month = d
    .toLocaleDateString("en-US", { month: "short" })
    .toUpperCase();
  const day = String(d.getDate());
  const year = String(d.getFullYear());
  const dow = d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  return { month, day, year, dow };
}

function formatOnSaleDate(dateStr: string | Date | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dateValue(dateStr: string | Date | null): number | null {
  if (!dateStr) return null;
  const date =
    dateStr instanceof Date
      ? dateStr
      : new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
            ? `${dateStr}T00:00:00`
            : dateStr,
        );
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function compareNullableDate(
  a: string | Date | null,
  b: string | Date | null,
  dir: "asc" | "desc",
): number {
  const aTime = dateValue(a);
  const bTime = dateValue(b);
  if (aTime == null && bTime == null) return 0;
  if (aTime == null) return 1;
  if (bTime == null) return -1;
  return (dir === "desc" ? -1 : 1) * (aTime - bTime);
}

function compareAnnouncements(
  a: Announcement,
  b: Announcement,
  sort: DiscoverSortConfig,
): number {
  const flip = sort.dir === "desc" ? -1 : 1;
  let result = 0;

  switch (sort.field) {
    case "showDate":
      result = compareNullableDate(a.showDate, b.showDate, sort.dir);
      break;
    case "kind":
      result = flip * (DISCOVER_KIND_ORDER[a.kind] - DISCOVER_KIND_ORDER[b.kind]);
      break;
    case "venue":
      result = flip * a.venue.name.localeCompare(b.venue.name);
      break;
    case "headliner":
      result = flip * a.headliner.localeCompare(b.headliner);
      break;
    case "onSaleDate":
      result = compareNullableDate(a.onSaleDate, b.onSaleDate, sort.dir);
      break;
    case "onSaleStatus":
      result =
        flip *
        (ON_SALE_STATUS_ORDER[a.onSaleStatus] -
          ON_SALE_STATUS_ORDER[b.onSaleStatus]);
      break;
  }

  if (result !== 0) return result;

  const dateTie = compareNullableDate(a.showDate, b.showDate, "asc");
  if (dateTie !== 0) return dateTie;
  return a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Watch / Unwatch Button
// ---------------------------------------------------------------------------

function WatchButton({
  announcementId,
  isWatching,
  onToggle,
}: {
  announcementId: string;
  isWatching: boolean;
  onToggle: (id: string, watching: boolean) => void;
}) {
  const watchMutation = trpc.discover.watchlist.useMutation({
    onSuccess: () => onToggle(announcementId, true),
    onError: () => onToggle(announcementId, false),
  });

  const unwatchMutation = trpc.discover.unwatchlist.useMutation({
    onSuccess: () => onToggle(announcementId, false),
    onError: () => onToggle(announcementId, true),
  });

  const isPending = watchMutation.isPending || unwatchMutation.isPending;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (isPending) return;

    // Optimistic toggle
    onToggle(announcementId, !isWatching);

    if (isWatching) {
      unwatchMutation.mutate({ announcementId });
    } else {
      watchMutation.mutate({ announcementId });
    }
  }

  return (
    <button
      type="button"
      className={`discover-watch-btn ${isWatching ? "discover-watch-btn--watching" : ""}`}
      onClick={handleClick}
      disabled={isPending}
    >
      {isWatching ? (
        <>
          <Check size={11} />
          Watching
        </>
      ) : (
        <>
          <Eye size={11} />
          Watch
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Announcement Row
// ---------------------------------------------------------------------------

function AnnouncementRow({
  announcement,
  isWatching,
  onToggleWatch,
  showReason,
  groupBy,
}: {
  announcement: Announcement;
  isWatching: boolean;
  onToggleWatch: (id: string, watching: boolean) => void;
  showReason: boolean;
  groupBy: "venue" | "artist" | "region";
}) {
  const date = formatShowDateShort(announcement.showDate);
  const KindIcon = KIND_ICONS[announcement.kind];
  const isOnSale = announcement.onSaleStatus === "on_sale";
  const runMode = isRun(announcement);
  const runDateLabel =
    runMode && announcement.runStartDate && announcement.runEndDate
      ? formatRunRange(announcement.runStartDate, announcement.runEndDate)
      : null;
  const performanceCount = announcement.performanceDates?.length ?? 0;
  const reasonText =
    announcement.reason && REASON_LABELS[announcement.reason]
      ? REASON_LABELS[announcement.reason]
      : announcement.reason || null;

  return (
    <div
      className={`discover-row discover-row--${announcement.kind} ${isWatching ? "discover-row--watched" : ""} ${runMode ? "discover-row--run" : ""} ${groupBy === "region" ? "discover-row--region" : ""}`}
    >
      {/* Date */}
      <div>
        {runMode && runDateLabel ? (
          <>
            <div className="discover-row__date-main" title={`${performanceCount} dates`}>
              {runDateLabel}
            </div>
            <div className="discover-row__date-sub">
              {performanceCount} dates
            </div>
          </>
        ) : (
          <>
            <div className="discover-row__date-main">
              {date.month} {date.day}
            </div>
            <div className="discover-row__date-sub">
              {date.year} &middot; {date.dow}
            </div>
          </>
        )}
      </div>

      {/* Kind */}
      <div
        className={`discover-row__kind discover-row__kind--${announcement.kind}`}
      >
        <KindIcon size={12} />
        {KIND_LABELS[announcement.kind]}
      </div>

      {/* Venue (region mode only — separate cell before Headliner) */}
      {groupBy === "region" && (
        <div className="discover-row__venue-cell">
          <div className="discover-row__venue-name">
            <Link
              href={`/venues/${announcement.venue.id}`}
              className="discover-row__headliner-link"
              onClick={(e) => e.stopPropagation()}
            >
              {announcement.venue.name}
            </Link>
          </div>
          {announcement.venue.city && (
            <div className="discover-row__support">
              {announcement.venue.city}
            </div>
          )}
        </div>
      )}

      {/* Headliner / Venue */}
      <div className="discover-row__headliner-cell">
        {groupBy === "artist" ? (
          <>
            <div className="discover-row__headliner">
              <Link
                href={`/venues/${announcement.venue.id}`}
                className="discover-row__headliner-link"
                onClick={(e) => e.stopPropagation()}
              >
                {announcement.venue.name}
              </Link>
            </div>
            {announcement.venue.city && (
              <div className="discover-row__support">
                {announcement.venue.city}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="discover-row__headliner">
              {announcement.headlinerPerformerId ? (
                <Link
                  href={`/artists/${announcement.headlinerPerformerId}`}
                  className="discover-row__headliner-link"
                  onClick={(e) => e.stopPropagation()}
                >
                  {announcement.headliner}
                </Link>
              ) : (
                announcement.headliner
              )}
            </div>
            {announcement.support && announcement.support.length > 0 && (
              <div className="discover-row__support">
                + {announcement.support.join(", ")}
              </div>
            )}
            {showReason && reasonText && (
              <div className="discover-row__reason">{reasonText}</div>
            )}
          </>
        )}
      </div>

      {/* On Sale */}
      <div className="discover-row__onsale-cell">
        <div
          className={`discover-row__onsale ${isOnSale ? "discover-row__onsale--active" : ""}`}
        >
          {formatOnSaleDate(announcement.onSaleDate)}
        </div>
      </div>

      {/* Status */}
      <div className="discover-row__status-cell">
        <span
          className={`discover-row__status-badge discover-row__status-badge--${announcement.onSaleStatus} discover-row__status-badge--${announcement.kind}`}
        >
          {ON_SALE_STATUS_LABELS[announcement.onSaleStatus]}
        </span>
      </div>

      {/* Actions */}
      <div className="discover-row__actions">
        {announcement.kind !== "sports" && (
          <WatchButton
            announcementId={announcement.id}
            isWatching={isWatching}
            onToggle={onToggleWatch}
          />
        )}
        <a
          href={`/api/announcements/${announcement.id}/ical`}
          download
          data-testid="add-to-calendar"
          className="discover-tix-btn"
          onClick={(e) => e.stopPropagation()}
        >
          <CalendarPlus size={11} />
          Calendar
        </a>
        {announcement.ticketUrl && (
          <a
            href={announcement.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="discover-tix-btn"
            onClick={(e) => e.stopPropagation()}
          >
            <ArrowUpRight size={11} />
            Tix
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Venue Rail (left sidebar filter)
// ---------------------------------------------------------------------------

function VenueRail({
  venues,
  regionGroups,
  selected,
  onSelect,
  tabLabel,
  totalCount,
  showFollowLink,
  onFollowVenue,
  onUnfollowItem,
  showAddRegion,
  onAddRegion,
  addRegionDisabled,
  addRegionHint,
  onUnfollowRegion,
  showArtistSearch,
}: {
  venues: {
    id: string;
    name: string;
    label?: string;
    count: number;
  }[];
  regionGroups?: {
    id: string;
    cityName: string;
    radiusMiles: number;
    venues: { id: string; name: string; label?: string; count: number }[];
  }[] | null;
  selected: string | null;
  onSelect: (venueId: string | null) => void;
  tabLabel: string;
  totalCount: number;
  showFollowLink: boolean;
  onFollowVenue?: () => void;
  onUnfollowItem?: (id: string) => void;
  showAddRegion?: boolean;
  onAddRegion?: () => void;
  addRegionDisabled?: boolean;
  addRegionHint?: string;
  onUnfollowRegion?: (regionId: string) => void;
  showArtistSearch?: boolean;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [railRegionContextMenu, setRailRegionContextMenu] = useState<{ x: number; y: number; regionId: string } | null>(null);
  const [collapsedRailRegions, setCollapsedRailRegions] = useState<Set<string>>(new Set());
  const [artistSearchOpen, setArtistSearchOpen] = useState(false);
  const [artistQuery, setArtistQuery] = useState("");
  const [debouncedArtistQuery, setDebouncedArtistQuery] = useState("");
  const artistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const artistInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const artistSearchResults = trpc.discover.searchArtists.useQuery(
    { keyword: debouncedArtistQuery },
    { enabled: debouncedArtistQuery.length >= 2 },
  );

  const followAttraction = trpc.performers.followAttraction.useMutation({
    onSuccess: () => {
      utils.discover.followedArtistsFeed.invalidate();
      setArtistSearchOpen(false);
      setArtistQuery("");
      setDebouncedArtistQuery("");
    },
  });

  useEffect(() => {
    if (artistSearchOpen) {
      artistInputRef.current?.focus();
    }
  }, [artistSearchOpen]);

  const handleArtistQueryChange = (value: string) => {
    setArtistQuery(value);
    if (artistTimerRef.current) clearTimeout(artistTimerRef.current);
    if (value.length >= 2) {
      artistTimerRef.current = setTimeout(() => setDebouncedArtistQuery(value), 350);
    } else {
      setDebouncedArtistQuery("");
    }
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    if (!onUnfollowItem) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, id });
  };

  return (
    <aside className="discover-rail">
      <div className="discover-rail__title">{tabLabel}</div>

      {showFollowLink && (
        <div className="discover-rail__follow discover-rail__follow--top">
          <button type="button" className="discover-rail__follow-link" onClick={onFollowVenue}>
            <Plus size={11} />
            Follow another venue
          </button>
        </div>
      )}

      {showAddRegion && (
        <div className="discover-rail__follow discover-rail__follow--top">
          <button
            type="button"
            className="discover-rail__follow-link"
            onClick={onAddRegion}
            disabled={addRegionDisabled}
            title={addRegionHint}
          >
            <Plus size={11} />
            Follow another region
          </button>
          {addRegionHint && (
            <div className="discover-rail__follow-hint">{addRegionHint}</div>
          )}
        </div>
      )}

      {/* "Follow another artist" affordance */}
      {showArtistSearch && (
        <div className="discover-rail__follow discover-rail__follow--top">
          {artistSearchOpen ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid var(--rule)", paddingBottom: 6 }}>
                <Search size={11} color="var(--muted)" />
                <input
                  ref={artistInputRef}
                  value={artistQuery}
                  onChange={(e) => handleArtistQueryChange(e.target.value)}
                  placeholder="Search artists..."
                  style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--ink)", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11 }}
                />
                <button type="button" onClick={() => { setArtistSearchOpen(false); setArtistQuery(""); setDebouncedArtistQuery(""); }} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}>
                  <X size={11} />
                </button>
              </div>
              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                {debouncedArtistQuery.length >= 2 && artistSearchResults.isLoading && (
                  <div style={{ padding: "6px 0", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10, color: "var(--muted)" }}>Searching...</div>
                )}
                {artistSearchResults.data?.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => followAttraction.mutate({ tmAttractionId: a.id, name: a.name, imageUrl: a.imageUrl ?? undefined })}
                    disabled={followAttraction.isPending}
                    style={{ display: "block", width: "100%", padding: "6px 0", background: "none", border: "none", borderBottom: "1px solid var(--rule)", textAlign: "left", cursor: "pointer", opacity: followAttraction.isPending ? 0.5 : 1 }}
                  >
                    <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 12, color: "var(--ink)", fontWeight: 500 }}>{a.name}</div>
                  </button>
                ))}
                {debouncedArtistQuery.length >= 2 && !artistSearchResults.isLoading && (artistSearchResults.data?.length ?? 0) === 0 && (
                  <div style={{ padding: "6px 0", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10, color: "var(--muted)" }}>No artists found</div>
                )}
              </div>
            </div>
          ) : (
            <button type="button" className="discover-rail__follow-link" onClick={() => setArtistSearchOpen(true)}>
              <Plus size={11} />
              Follow another artist
            </button>
          )}
        </div>
      )}

      {/* "All" item */}
      <button
        type="button"
        className={`discover-rail__item ${selected === null ? "discover-rail__item--active" : ""}`}
        onClick={() => onSelect(null)}
      >
        <div className="discover-rail__item-body">
          <div className="discover-rail__item-name">
            {tabLabel === "Followed regions" ? "All regions" : "All followed"}
          </div>
        </div>
        <div className="discover-rail__item-count">{totalCount}</div>
      </button>

      {/* Per-venue items — grouped under region headers when regionGroups is supplied (Near You) */}
      {regionGroups
        ? regionGroups.map((region) => {
            const collapsed = collapsedRailRegions.has(region.id);
            return (
              <div key={region.id} className="discover-rail__region">
                <button
                  type="button"
                  className="discover-rail__section-header"
                  onContextMenu={(e) => {
                    if (!onUnfollowRegion || region.id === "__unknown") return;
                    e.preventDefault();
                    setRailRegionContextMenu({ x: e.clientX, y: e.clientY, regionId: region.id });
                  }}
                  onClick={() =>
                    setCollapsedRailRegions((prev) => {
                      const next = new Set(prev);
                      if (next.has(region.id)) next.delete(region.id);
                      else next.add(region.id);
                      return next;
                    })
                  }
                  aria-expanded={!collapsed}
                  aria-controls={`rail-region-${region.id}`}
                >
                  <span className="discover-rail__section-name">
                    <span className="discover-rail__section-chevron" aria-hidden="true">
                      {collapsed ? "▶" : "▼"}
                    </span>
                    {region.cityName}
                  </span>
                  <span className="discover-rail__section-meta">
                    {region.radiusMiles}mi
                  </span>
                </button>
                {!collapsed && (
                  <div id={`rail-region-${region.id}`}>
                    {region.venues.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className={`discover-rail__item ${selected === v.id ? "discover-rail__item--active" : ""}`}
                        onClick={() => onSelect(selected === v.id ? null : v.id)}
                        onContextMenu={(e) => handleContextMenu(e, v.id)}
                      >
                        <div className="discover-rail__item-body">
                          <div className="discover-rail__item-name">{v.name}</div>
                          {v.label && (
                            <div className="discover-rail__item-nbhd">
                              {v.label.toLowerCase()}
                            </div>
                          )}
                        </div>
                        <div className="discover-rail__item-count">{v.count}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        : venues.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`discover-rail__item ${selected === v.id ? "discover-rail__item--active" : ""}`}
              onClick={() => onSelect(selected === v.id ? null : v.id)}
              onContextMenu={(e) => handleContextMenu(e, v.id)}
            >
              <div className="discover-rail__item-body">
                <div className="discover-rail__item-name">{v.name}</div>
                {v.label && (
                  <div className="discover-rail__item-nbhd">
                    {v.label.toLowerCase()}
                  </div>
                )}
              </div>
              <div className="discover-rail__item-count">{v.count}</div>
            </button>
          ))}

      {contextMenu && onUnfollowItem && (
        <ContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          items={[{ label: "Unfollow", onClick: () => onUnfollowItem(contextMenu.id), danger: true }]}
          onClose={() => setContextMenu(null)}
        />
      )}
      {railRegionContextMenu && onUnfollowRegion && (
        <ContextMenu
          position={{ x: railRegionContextMenu.x, y: railRegionContextMenu.y }}
          items={[{
            label: "Unfollow region",
            onClick: () => onUnfollowRegion(railRegionContextMenu.regionId),
            danger: true,
          }]}
          onClose={() => setRailRegionContextMenu(null)}
        />
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Mobile Venue Chips
// ---------------------------------------------------------------------------

function VenueChips({
  venues,
  selected,
  onSelect,
  totalCount,
}: {
  venues: { id: string; name: string; count: number }[];
  selected: string | null;
  onSelect: (venueId: string | null) => void;
  totalCount: number;
}) {
  return (
    <div className="discover-chips">
      <button
        type="button"
        className={`discover-chip ${selected === null ? "discover-chip--active" : ""}`}
        onClick={() => onSelect(null)}
      >
        All
        <span className="discover-chip__count">{totalCount}</span>
      </button>
      {venues.map((v) => (
        <button
          key={v.id}
          type="button"
          className={`discover-chip ${selected === v.id ? "discover-chip--active" : ""}`}
          onClick={() => onSelect(selected === v.id ? null : v.id)}
        >
          {v.name}
          <span className="discover-chip__count">{v.count}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed Section (used by both tabs)
// ---------------------------------------------------------------------------

function FeedSection({
  items,
  isLoading,
  emptyMessage,
  watchedIds,
  onToggleWatch,
  activeTab,
  onVenueFollowed,
  groupBy,
  allFollowedVenues,
  hasRegions,
  pendingIngestRegionIds,
  activeRegions,
  regionCount,
  onRegionAdded,
}: {
  items: Announcement[] | undefined;
  isLoading: boolean;
  emptyMessage: string;
  watchedIds: Set<string>;
  onToggleWatch: (id: string, watching: boolean) => void;
  activeTab: string;
  onVenueFollowed: () => void;
  groupBy: "venue" | "artist" | "region";
  allFollowedVenues?: { id: string; name: string; city: string }[];
  hasRegions?: boolean;
  pendingIngestRegionIds?: Set<string>;
  activeRegions?: { id: string; cityName: string; radiusMiles: number }[];
  regionCount?: number;
  onRegionAdded?: (regionId: string) => void;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [showRegionModal, setShowRegionModal] = useState(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  const [regionContextMenu, setRegionContextMenu] = useState<{ x: number; y: number; regionId: string } | null>(null);
  const [sort, setSort] = useState<DiscoverSortConfig>(DISCOVER_DEFAULT_SORT);

  const utils = trpc.useUtils();

  const unfollowVenueMutation = trpc.venues.unfollow.useMutation({
    onMutate: ({ venueId }) => {
      setSelectedGroupId((prev) => (prev === venueId ? null : prev));
    },
    onSuccess: () => {
      utils.venues.followed.invalidate();
      utils.discover.followedFeed.invalidate();
      utils.discover.nearbyFeed.invalidate();
    },
  });

  const unfollowArtistMutation = trpc.performers.unfollow.useMutation({
    onMutate: ({ performerId }) => {
      setSelectedGroupId((prev) => (prev === performerId ? null : prev));
    },
    onSuccess: () => {
      utils.discover.followedArtistsFeed.invalidate();
    },
  });

  const removeRegionMutation = trpc.preferences.removeRegion.useMutation({
    onMutate: ({ regionId }) => {
      setSelectedGroupId(null);
      setCollapsedGroupIds((prev) => {
        if (!prev.has(regionId)) return prev;
        const next = new Set(prev);
        next.delete(regionId);
        return next;
      });
    },
    onSuccess: () => {
      utils.discover.nearbyFeed.invalidate();
      utils.preferences.get.invalidate();
    },
  });

  const handleUnfollowItem = useCallback((id: string) => {
    if (groupBy === "venue") {
      unfollowVenueMutation.mutate({ venueId: id });
    } else {
      unfollowArtistMutation.mutate({ performerId: id });
    }
  }, [groupBy, unfollowVenueMutation, unfollowArtistMutation]);

  const toggleSort = useCallback((field: DiscoverSortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" },
    );
  }, []);

  const toggleCollapsedGroup = useCallback((groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  function getGroupKey(item: Announcement): string | null {
    return groupBy === "artist" ? item.headlinerPerformerId : item.venue.id;
  }

  // Extract unique groups (venues or artists) with counts
  const groupList = useMemo(() => {
    const seen = new Map<
      string,
      { id: string; name: string; label?: string; count: number }
    >();

    // For followed-venues tab, seed with all followed venues (count=0) so newly
    // followed venues appear in the rail even before announcements are ingested.
    if (groupBy === "venue" && allFollowedVenues) {
      for (const v of allFollowedVenues) {
        seen.set(v.id, { id: v.id, name: v.name, label: v.city, count: 0 });
      }
    }

    if (items) {
      for (const item of items) {
        const key = getGroupKey(item);
        if (!key) continue;
        if (!seen.has(key)) {
          seen.set(key, {
            id: key,
            name: groupBy === "artist" ? item.headliner : item.venue.name,
            label: groupBy === "artist" ? undefined : item.venue.city,
            count: 0,
          });
        }
        seen.get(key)!.count++;
      }
    }
    return Array.from(seen.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, groupBy, allFollowedVenues]);

  // Filter items by selected group
  const filteredItems = useMemo(() => {
    if (!items) return [];
    if (!selectedGroupId) return items;
    return items.filter((item) => getGroupKey(item) === selectedGroupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedGroupId, groupBy]);

  const sortedFilteredItems = useMemo(
    () => [...filteredItems].sort((a, b) => compareAnnouncements(a, b, sort)),
    [filteredItems, sort],
  );

  // Group rows (when "All" is selected)
  const groups = useMemo(() => {
    if (selectedGroupId) {
      const g = groupList.find((g) => g.id === selectedGroupId) || {
        id: selectedGroupId,
        name: "",
        label: "",
        count: 0,
      };
      return [{ group: g, items: sortedFilteredItems }];
    }
    return groupList.map((g) => ({
      group: g,
      items: sortedFilteredItems.filter((item) => getGroupKey(item) === g.id),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedFilteredItems, groupList, selectedGroupId, groupBy]);

  // Region groups for the right-side Near You feed. The input has already
  // been filtered by the selected venue and sorted by the active column.
  // Seeded with all active regions so an empty/just-added region still
  // renders a header (the ingest pending indicator hangs off the header).
  const regionGroups = useMemo(() => {
    if (activeTab !== "Near You") return null;
    return groupAnnouncementsByRegion(sortedFilteredItems, activeRegions, null);
  }, [sortedFilteredItems, activeTab, activeRegions]);

  // Rail's region-grouped venue list. Always built from the unfiltered set
  // so clicking a venue doesn't change other venue counts in the rail.
  const regionVenueGroups = useMemo(() => {
    if (activeTab !== "Near You") return null;
    return groupVenuesByRegion(items, activeRegions);
  }, [items, activeTab, activeRegions]);

  const totalCount = groupList.length;
  const isFollowed = activeTab === "Followed";
  const isArtists = activeTab === "Artists";
  const isNearby = activeTab === "Near You";
  const tabLabel = isFollowed
    ? "Followed venues"
    : isArtists
      ? "Followed artists"
      : "Followed regions";
  const showAllGrouped = selectedGroupId === null;
  const groupRoute = groupBy === "artist" ? "artists" : "venues";
  const groupPageLabel = groupBy === "artist" ? "artist page" : "venue page";

  function handleFollowVenue() {
    setShowFollowModal(true);
  }

  function handleVenueFollowed() {
    setShowFollowModal(false);
    onVenueFollowed();
  }

  function handleRegionAdded(regionId: string) {
    utils.preferences.get.invalidate();
    utils.discover.nearbyFeed.invalidate();
    setShowRegionModal(false);
    onRegionAdded?.(regionId);
  }

  const followModal = showFollowModal && (
    <VenueSearchModal
      onClose={() => setShowFollowModal(false)}
      onFollowed={handleVenueFollowed}
    />
  );
  const regionModal = showRegionModal && (
    <RegionSearchModal
      onClose={() => setShowRegionModal(false)}
      onAdded={handleRegionAdded}
    />
  );
  const totalRegionCount = regionCount ?? activeRegions?.length ?? 0;
  const regionLimitReached = totalRegionCount >= 5;

  const venueRail = (
    <VenueRail
      venues={groupList}
      regionGroups={isNearby ? regionVenueGroups : null}
      selected={selectedGroupId}
      onSelect={setSelectedGroupId}
      tabLabel={tabLabel}
      totalCount={isNearby ? totalRegionCount : totalCount}
      showFollowLink={isFollowed}
      onFollowVenue={handleFollowVenue}
      onUnfollowItem={(isFollowed || isArtists) ? handleUnfollowItem : undefined}
      showAddRegion={isNearby}
      onAddRegion={() => setShowRegionModal(true)}
      addRegionDisabled={regionLimitReached}
      addRegionHint={regionLimitReached ? "Maximum 5 regions" : `${totalRegionCount} / 5 regions`}
      onUnfollowRegion={isNearby ? (regionId) => removeRegionMutation.mutate({ regionId }) : undefined}
      showArtistSearch={isArtists}
    />
  );

  if (isLoading) {
    return (
      <div className="discover-main">
        {venueRail}
        <div className="discover-list" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 96,
                borderBottom: "1px solid var(--rule)",
                background: "var(--surface)",
                padding: "16px 20px",
                display: "grid",
                gridTemplateColumns: "1fr",
                alignContent: "center",
                gap: 8,
              }}
            >
              <div style={{ height: 14, width: "40%", background: "var(--rule)" }} />
              <div style={{ height: 12, width: "65%", background: "var(--rule)" }} />
              <div style={{ height: 10, width: "25%", background: "var(--rule)" }} />
            </div>
          ))}
        </div>
        {followModal}
        {regionModal}
      </div>
    );
  }

  // For Near You with active regions, fall through to the main render even
  // when items is empty so region headers (and the ingest pending indicator)
  // still appear. For other tabs, show the empty state.
  const hasAnyRegionsToShow = activeTab === "Near You" && (regionGroups?.length ?? 0) > 0;
  if ((!items || items.length === 0) && !hasAnyRegionsToShow) {
    const hasFollowedVenues = groupBy === "venue" && (allFollowedVenues?.length ?? 0) > 0;
    const title = hasFollowedVenues
      ? "Quiet week"
      : isArtists
        ? "Follow artists"
        : isNearby
          ? "Set your radius"
          : "Follow venues";
    const body = hasFollowedVenues
      ? "No announcements from followed venues right now. Check back Monday after the weekly digest lands."
      : emptyMessage;
    const action = isFollowed && !hasFollowedVenues ? (
      <button
        type="button"
        onClick={handleFollowVenue}
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
        Follow a venue
      </button>
    ) : isNearby && !hasRegions ? (
      <button
        type="button"
        onClick={() => setShowRegionModal(true)}
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
        Add region
      </button>
    ) : null;

    return (
      <div className="discover-main">
        {venueRail}
        <div className="discover-empty">
          <EmptyState
            kind="discover"
            title={title}
            body={body}
            action={action}
          />
        </div>
        {followModal}
        {regionModal}
      </div>
    );
  }

  return (
    <div className="discover-main">
      {/* Left Rail (desktop) */}
      {venueRail}

      {/* Mobile Chips */}
      <VenueChips
        venues={groupList}
        selected={selectedGroupId}
        onSelect={setSelectedGroupId}
        totalCount={totalCount}
      />

      {/* Feed */}
      <div className="discover-feed">
        {/* Column headers */}
        <div className={`discover-col-headers ${groupBy === "region" ? "discover-col-headers--region" : ""}`}>
          <SortHeader<DiscoverSortField>
            field="showDate"
            label="Show date"
            sort={sort}
            onToggle={toggleSort}
          />
          <SortHeader<DiscoverSortField>
            field="kind"
            label="Kind"
            sort={sort}
            onToggle={toggleSort}
          />
          {groupBy === "region" && (
            <SortHeader<DiscoverSortField>
              field="venue"
              label="Venue"
              sort={sort}
              onToggle={toggleSort}
            />
          )}
          <SortHeader<DiscoverSortField>
            field={groupBy === "artist" ? "venue" : "headliner"}
            label={groupBy === "artist" ? "Venue" : "Headliner"}
            sort={sort}
            onToggle={toggleSort}
          />
          <SortHeader<DiscoverSortField>
            field="onSaleDate"
            label="On sale"
            sort={sort}
            onToggle={toggleSort}
          />
          <SortHeader<DiscoverSortField>
            field="onSaleStatus"
            label="Status"
            sort={sort}
            onToggle={toggleSort}
          />
          <div />
        </div>

        {/* Near You: grouped by region. When the user has selected a venue,
            hide regions that contributed no items (the filter narrowed away
            their entire content) — keep their empty headers only if a
            pending ingest indicator needs to live there. */}
        {isNearby && regionGroups ? (
          regionGroups
            .filter((region) =>
              selectedGroupId === null
              || region.items.length > 0
              || (pendingIngestRegionIds?.has(region.id) ?? false),
            )
            .map((region) => {
            const collapsed = collapsedGroupIds.has(region.id);
            const isPendingIngest = pendingIngestRegionIds?.has(region.id) ?? false;
            return (
              <div key={region.id} className="discover-venue-group">
                <div
                  className="discover-venue-group__header discover-venue-group__header--region"
                  onContextMenu={(e) => {
                    if (region.id === "__unknown") return;
                    e.preventDefault();
                    setRegionContextMenu({ x: e.clientX, y: e.clientY, regionId: region.id });
                  }}
                >
                  <button
                    type="button"
                    className="discover-venue-group__name discover-venue-group__toggle"
                    onClick={() => toggleCollapsedGroup(region.id)}
                    aria-expanded={!collapsed}
                    aria-controls={`discover-group-${region.id}`}
                  >
                    <span className="discover-venue-group__chevron" aria-hidden="true">
                      {collapsed ? "▶" : "▼"}
                    </span>
                    {region.cityName}
                  </button>
                  <span className="discover-venue-group__meta">
                    {region.radiusMiles}mi · {region.items.length} upcoming
                    {isPendingIngest && (
                      <span
                        className="discover-region-ingest-pending"
                        data-testid="region-ingest-pending"
                      >
                        {" · "}Discovering shows in {region.cityName}…
                      </span>
                    )}
                  </span>
                  <div className="discover-venue-group__rule" />
                </div>
                {!collapsed && (
                  <div id={`discover-group-${region.id}`}>
                    {region.items.map((item) => (
                      <AnnouncementRow
                        key={item.id}
                        announcement={item}
                        isWatching={watchedIds.has(item.id)}
                        onToggleWatch={onToggleWatch}
                        showReason={false}
                        groupBy={groupBy}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          /* Followed venues / Artists: standard grouping */
          groups.map(({ group, items: groupItems }) => {
            const collapsed = group.id ? collapsedGroupIds.has(group.id) : false;
            return (
              <div key={group.id || "flat"} className="discover-venue-group">
                {/* Group header (only when "All" is selected) */}
                {showAllGrouped && group.id && (
                  <div className="discover-venue-group__header">
                    <button
                      type="button"
                      className="discover-venue-group__name discover-venue-group__toggle"
                      onClick={() => toggleCollapsedGroup(group.id)}
                      aria-expanded={!collapsed}
                      aria-controls={`discover-group-${group.id}`}
                    >
                      <span className="discover-venue-group__chevron" aria-hidden="true">
                        {collapsed ? "▶" : "▼"}
                      </span>
                      {group.name}
                    </button>
                    <span className="discover-venue-group__meta">
                      {group.label
                        ? group.label.toLowerCase() + " · "
                        : ""}
                      {groupItems.length} upcoming
                    </span>
                    <div className="discover-venue-group__rule" />
                    <Link
                      href={`/${groupRoute}/${group.id}`}
                      className="discover-venue-group__link"
                    >
                      {groupPageLabel} &rarr;
                    </Link>
                  </div>
                )}

                {/* Announcement rows */}
                {(!showAllGrouped || !group.id || !collapsed) && (
                  <div id={group.id ? `discover-group-${group.id}` : undefined}>
                    {groupItems.map((item) => (
                      <AnnouncementRow
                        key={item.id}
                        announcement={item}
                        isWatching={watchedIds.has(item.id)}
                        onToggleWatch={onToggleWatch}
                        showReason={showAllGrouped}
                        groupBy={groupBy}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Footer */}
        <div className="discover-footer">
          <span>
            past items fall off silently after show date &middot; no dismiss
            needed
          </span>
          <span className="discover-footer__right">
            daily digest &middot; 08:00 &middot; email
          </span>
        </div>
      </div>

      {/* Region right-click context menu */}
      {regionContextMenu && (
        <ContextMenu
          position={{ x: regionContextMenu.x, y: regionContextMenu.y }}
          items={[{
            label: "Unfollow region",
            danger: true,
            onClick: () => removeRegionMutation.mutate({ regionId: regionContextMenu.regionId }),
          }]}
          onClose={() => setRegionContextMenu(null)}
        />
      )}

      {followModal}
      {regionModal}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Region Ingest Poller — invisible component that watches one region's
// pg-boss ingest status and notifies the parent. Polls every 2s while
// pending; stops polling when the job completes/fails. On the
// pending→done transition, invalidates the nearbyFeed so just-ingested
// shows appear without manual refresh.
// ---------------------------------------------------------------------------

function RegionIngestPoller({
  regionId,
  onPendingChange,
}: {
  regionId: string;
  onPendingChange: (regionId: string, pending: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const status = trpc.discover.regionIngestStatus.useQuery(
    { regionId },
    {
      refetchInterval: (query) =>
        query.state.data?.pending ? 2000 : false,
      refetchOnWindowFocus: false,
    },
  );
  const pending = status.data?.pending ?? false;
  const prevPendingRef = useRef(pending);
  useEffect(() => {
    onPendingChange(regionId, pending);
    if (prevPendingRef.current && !pending) {
      utils.discover.nearbyFeed.invalidate();
    }
    prevPendingRef.current = pending;
  }, [pending, regionId, onPendingChange, utils.discover.nearbyFeed]);
  return null;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const TABS = [
  { key: "Followed", label: "Followed venues" },
  { key: "Artists", label: "Followed artists" },
  { key: "Near You", label: "Followed regions" },
] as const;

export default function DiscoverView() {
  const [activeTab, setActiveTab] = useState<string>("Followed");
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [pendingIngestRegionIds, setPendingIngestRegionIds] = useState<Set<string>>(new Set());

  const utils = trpc.useUtils();

  const followedFeed = trpc.discover.followedFeed.useQuery(
    { limit: 100 },
    { staleTime: 60_000 }
  );
  const followedVenuesList = trpc.venues.followed.useQuery(undefined, {
    staleTime: 60_000,
  });
  const preferences = trpc.preferences.get.useQuery();

  const nearbyFeed = trpc.discover.nearbyFeed.useQuery(
    {},
    { staleTime: 60_000 }
  );

  const handlePendingChange = useCallback(
    (regionId: string, pending: boolean) => {
      setPendingIngestRegionIds((prev) => {
        if (pending && prev.has(regionId)) return prev;
        if (!pending && !prev.has(regionId)) return prev;
        const next = new Set(prev);
        if (pending) next.add(regionId);
        else next.delete(regionId);
        return next;
      });
    },
    [],
  );

  const activeRegions = preferences.data?.regions?.filter((r) => r.active) ?? [];

  const followedArtistsFeed = trpc.discover.followedArtistsFeed.useQuery(
    { limit: 100 },
    { staleTime: 60_000 }
  );

  const refreshNow = trpc.discover.refreshNow.useMutation({
    onSuccess: (data) => {
      setRefreshMessage(
        `Looking for new shows at ${data.enqueuedVenues} venue${data.enqueuedVenues === 1 ? "" : "s"} and ${data.enqueuedPerformers} artist${data.enqueuedPerformers === 1 ? "" : "s"}…`,
      );
      // Invalidate after a short delay so the targeted ingestion has time to land.
      setTimeout(() => {
        utils.discover.followedFeed.invalidate();
        utils.discover.followedArtistsFeed.invalidate();
        utils.discover.nearbyFeed.invalidate();
        setRefreshMessage(null);
      }, 8000);
    },
    onError: (err) => {
      setRefreshMessage(err.message);
      setTimeout(() => setRefreshMessage(null), 6000);
    },
  });

  function handleVenueFollowed() {
    utils.venues.followed.invalidate();
    utils.discover.followedFeed.invalidate();
    utils.discover.nearbyFeed.invalidate();
  }

  function handleToggleWatch(announcementId: string, watching: boolean) {
    setWatchedIds((prev) => {
      const next = new Set(prev);
      if (watching) {
        next.add(announcementId);
      } else {
        next.delete(announcementId);
      }
      return next;
    });
  }

  const followedItems = followedFeed.data?.items as
    | Announcement[]
    | undefined;
  const nearbyItems = nearbyFeed.data?.items as Announcement[] | undefined;
  const artistItems = followedArtistsFeed.data?.items as
    | Announcement[]
    | undefined;
  const currentItems =
    activeTab === "Followed"
      ? followedItems
      : activeTab === "Artists"
        ? artistItems
        : nearbyItems;
  const currentCount = currentItems?.length ?? 0;

  // Counts for tabs — show number of followed venues/artists, not announcements
  const followedVenueCount = useMemo(() => {
    if (!followedItems) return 0;
    return new Set(followedItems.map((a) => a.venueId)).size;
  }, [followedItems]);
  const nearbyCount = activeRegions.length;
  const artistsCount = useMemo(() => {
    if (!artistItems) return 0;
    return new Set(artistItems.map((a) => a.headlinerPerformerId).filter(Boolean)).size;
  }, [artistItems]);
  const tabCounts: Record<string, number> = {
    Followed: followedVenueCount,
    Artists: artistsCount,
    "Near You": nearbyCount,
  };

  return (
    <div className="discover-page">
      {/* Hidden ingest-status pollers, one per active region */}
      {activeRegions.map((r) => (
        <RegionIngestPoller
          key={r.id}
          regionId={r.id}
          onPendingChange={handlePendingChange}
        />
      ))}

      {/* Header */}
      <header className="discover-header">
        <div>
          <div className="discover-header__subtitle">
            {currentCount} announcements &middot; weekly Monday digest
          </div>
          <h1 className="discover-header__title">Discover</h1>
        </div>
        <div className="discover-header__actions">
          <button
            type="button"
            className="discover-refresh-btn"
            onClick={() => refreshNow.mutate()}
            disabled={refreshNow.isPending}
            title="Pull the latest events from Ticketmaster + scraped venues for everything you follow"
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              padding: "6px 10px",
              border: "1px solid var(--rule)",
              background: "transparent",
              color: refreshNow.isPending ? "var(--muted)" : "var(--ink)",
              cursor: refreshNow.isPending ? "default" : "pointer",
            }}
          >
            {refreshNow.isPending ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>
      {refreshMessage && (
        <div
          role="status"
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: "var(--muted)",
            margin: "0 0 12px",
          }}
        >
          {refreshMessage}
        </div>
      )}

      {/* Tabs */}
      <div className="discover-tabs-bar">
        <div className="discover-tabs">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`discover-tab ${activeTab === key ? "discover-tab--active" : ""}`}
              onClick={() => setActiveTab(key)}
            >
              <span>{label}</span>
              <span className="discover-tab__count">
                ({tabCounts[key]})
              </span>
            </button>
          ))}
        </div>
        <div className="discover-tabs-bar__spacer" />
      </div>

      {/* Feed sections */}
      {activeTab === "Followed" && (
        <FeedSection
          items={followedItems}
          isLoading={followedFeed.isLoading}
          emptyMessage="No announcements from followed venues"
          watchedIds={watchedIds}
          onToggleWatch={handleToggleWatch}
          activeTab={activeTab}
          onVenueFollowed={handleVenueFollowed}
          groupBy="venue"
          allFollowedVenues={followedVenuesList.data}
        />
      )}

      {activeTab === "Artists" && (
        <FeedSection
          items={artistItems}
          isLoading={followedArtistsFeed.isLoading}
          emptyMessage="No upcoming shows from artists you follow yet. Follow an artist on their detail page to see their upcoming tour dates here."
          watchedIds={watchedIds}
          onToggleWatch={handleToggleWatch}
          activeTab={activeTab}
          onVenueFollowed={handleVenueFollowed}
          groupBy="artist"
        />
      )}

      {activeTab === "Near You" && (
        <FeedSection
          items={nearbyItems}
          isLoading={nearbyFeed.isLoading}
          emptyMessage={nearbyFeed.data?.hasRegions ? "No announcements in followed regions right now" : "Follow a region in Preferences to see regional shows"}
          watchedIds={watchedIds}
          onToggleWatch={handleToggleWatch}
          activeTab={activeTab}
          onVenueFollowed={handleVenueFollowed}
          groupBy="region"
          hasRegions={nearbyFeed.data?.hasRegions}
          pendingIngestRegionIds={pendingIngestRegionIds}
          activeRegions={activeRegions}
          regionCount={preferences.data?.regions?.length ?? 0}
          onRegionAdded={(regionId) => {
            setPendingIngestRegionIds((prev) => {
              const next = new Set(prev);
              next.add(regionId);
              return next;
            });
          }}
        />
      )}
    </div>
  );
}
