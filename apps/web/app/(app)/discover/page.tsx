"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { type ShowKind } from "@/components/design-system";
import {
  Music,
  Clapperboard,
  Laugh,
  Tent,
  Trophy,
  Eye,
  Check,
  ArrowUpRight,
  Plus,
  Search,
  X,
  CalendarPlus,
} from "lucide-react";
import "./discover.css";

// ---------------------------------------------------------------------------
// Lightweight context menu (local; a shared one is coming post-merge)
// ---------------------------------------------------------------------------

function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: { label: string; onClick: () => void; danger?: boolean }[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener("scroll", handler, true);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") onClose();
    });
    return () => {
      document.removeEventListener("scroll", handler, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: y,
        left: x,
        background: "var(--surface)",
        border: "1px solid var(--rule-strong)",
        zIndex: 1000,
        minWidth: 140,
        boxShadow: "0 4px 16px rgba(0,0,0,.2)",
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => {
            item.onClick();
            onClose();
          }}
          style={{
            display: "block",
            width: "100%",
            padding: "10px 14px",
            background: "none",
            border: "none",
            color: item.danger ? "#E63946" : "var(--ink)",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            textAlign: "left",
            cursor: "pointer",
            letterSpacing: ".04em",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface2)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

type DiscoverKind = ShowKind | "sports";

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

const KIND_ICONS: Record<
  DiscoverKind,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  concert: Music,
  theatre: Clapperboard,
  comedy: Laugh,
  festival: Tent,
  sports: Trophy,
};

const KIND_LABELS: Record<DiscoverKind, string> = {
  concert: "Concert",
  theatre: "Theatre",
  comedy: "Comedy",
  festival: "Festival",
  sports: "Sports",
};

const REASON_LABELS: Record<string, string> = {
  "followed-venue": "followed venue",
  nearby: "near you",
  "tracked-artist": "tracked artist",
};

const ON_SALE_STATUS_LABELS: Record<string, string> = {
  announced: "announced",
  on_sale: "on sale",
  sold_out: "sold out",
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
// Venue Search Modal
// ---------------------------------------------------------------------------

function VenueSearchModal({
  onClose,
  onFollowed,
}: {
  onClose: () => void;
  onFollowed: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const searchResults = trpc.venues.search.useQuery(
    { query },
    { enabled: query.length >= 2 },
  );

  const placesResults = trpc.enrichment.searchPlaces.useQuery(
    { query, types: "venue" },
    { enabled: query.length >= 2 },
  );

  const followMutation = trpc.venues.follow.useMutation({
    onSuccess: () => {
      onFollowed();
      onClose();
    },
  });

  const createAndFollow = trpc.venues.createFromPlace.useMutation({
    onSuccess: (venue) => {
      followMutation.mutate({ venueId: venue.id });
    },
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const localVenues = searchResults.data ?? [];
  const places = placesResults.data ?? [];
  const localIds = new Set(localVenues.map((v) => v.googlePlaceId).filter(Boolean));
  const filteredPlaces = places.filter((p) => !localIds.has(p.placeId));
  const isPending = followMutation.isPending || createAndFollow.isPending;

  return (
    <div className="discover-modal-overlay" onClick={onClose}>
      <div
        className="discover-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="discover-modal__header">
          <div className="discover-modal__title">Follow a venue</div>
          <button
            type="button"
            className="discover-modal__close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        <div className="discover-modal__search">
          <Search size={13} color="var(--muted)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search venues..."
            className="discover-modal__input"
          />
        </div>

        <div className="discover-modal__results">
          {query.length < 2 && (
            <div className="discover-modal__hint">
              Type at least 2 characters to search
            </div>
          )}
          {query.length >= 2 && searchResults.isLoading && (
            <div className="discover-modal__hint">Searching...</div>
          )}
          {localVenues.map((venue) => (
            <button
              key={venue.id}
              type="button"
              className="discover-modal__result"
              onClick={() => followMutation.mutate({ venueId: venue.id })}
              disabled={isPending}
            >
              <div className="discover-modal__result-body">
                <div className="discover-modal__result-name">{venue.name}</div>
                <div className="discover-modal__result-meta">
                  {[venue.city, venue.stateRegion].filter(Boolean).join(", ")}
                </div>
              </div>
              <div className="discover-modal__result-action">
                <Plus size={12} />
                Follow
              </div>
            </button>
          ))}
          {filteredPlaces.length > 0 && localVenues.length > 0 && (
            <div className="discover-modal__hint" style={{ borderBottom: "1px solid var(--rule)" }}>
              From Google Places
            </div>
          )}
          {filteredPlaces.map((place) => (
            <button
              key={place.placeId}
              type="button"
              className="discover-modal__result"
              onClick={() => createAndFollow.mutate({ placeId: place.placeId })}
              disabled={isPending}
            >
              <div className="discover-modal__result-body">
                <div className="discover-modal__result-name">{place.displayName}</div>
                <div className="discover-modal__result-meta">{place.formattedAddress}</div>
              </div>
              <div className="discover-modal__result-action">
                <Plus size={12} />
                Follow
              </div>
            </button>
          ))}
          {query.length >= 2 && !searchResults.isLoading && localVenues.length === 0 && filteredPlaces.length === 0 && (
            <div className="discover-modal__hint">No venues found</div>
          )}
        </div>
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
  showArtistSearch?: boolean;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
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

      {/* "Follow another artist" affordance */}
      {showArtistSearch && (
        <div className="discover-rail__follow" style={{ marginTop: 0, marginBottom: 4 }}>
          {artistSearchOpen ? (
            <div style={{ padding: "8px 18px 4px" }}>
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
            {tabLabel === "Nearby venues" ? "All nearby" : "All followed"}
          </div>
        </div>
        <div className="discover-rail__item-count">{totalCount}</div>
      </button>

      {/* Per-venue items — grouped under region headers when regionGroups is supplied (Near You) */}
      {regionGroups
        ? regionGroups.map((region) => (
            <div key={region.id} className="discover-rail__region">
              <div className="discover-rail__section-header">
                <span className="discover-rail__section-name">
                  {region.cityName}
                </span>
                <span className="discover-rail__section-meta">
                  {region.radiusMiles}mi
                </span>
              </div>
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
          ))
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

      {showFollowLink && (
        <div className="discover-rail__follow">
          <button type="button" className="discover-rail__follow-link" onClick={onFollowVenue}>
            <Plus size={11} />
            Follow another venue
          </button>
        </div>
      )}

      {contextMenu && onUnfollowItem && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[{ label: "Unfollow", onClick: () => onUnfollowItem(contextMenu.id), danger: true }]}
          onClose={() => setContextMenu(null)}
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
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [collapsedRegions, setCollapsedRegions] = useState<Set<string>>(new Set());
  const [regionContextMenu, setRegionContextMenu] = useState<{ x: number; y: number; regionId: string } | null>(null);

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

  // Group rows (when "All" is selected)
  const groups = useMemo(() => {
    if (selectedGroupId) {
      const g = groupList.find((g) => g.id === selectedGroupId) || {
        id: selectedGroupId,
        name: "",
        label: "",
        count: 0,
      };
      return [{ group: g, items: filteredItems }];
    }
    return groupList.map((g) => ({
      group: g,
      items: filteredItems.filter((item) => getGroupKey(item) === g.id),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredItems, groupList, selectedGroupId, groupBy]);

  // Region groups for Near You tab. Seed with all active regions so newly-
  // added regions (with no announcements yet) still render a header — the
  // ingest pending indicator hangs off the header.
  const regionGroups = useMemo(() => {
    if (activeTab !== "Near You") return null;
    const regions = new Map<string, { id: string; cityName: string; radiusMiles: number; items: Announcement[] }>();
    if (activeRegions) {
      for (const r of activeRegions) {
        regions.set(r.id, { id: r.id, cityName: r.cityName, radiusMiles: r.radiusMiles, items: [] });
      }
    }
    if (items) {
      for (const item of items) {
        const rid = item.regionId ?? "__unknown";
        const rname = item.regionCityName ?? "Unknown";
        const rradius = item.regionRadiusMiles ?? 0;
        if (!regions.has(rid)) {
          regions.set(rid, { id: rid, cityName: rname, radiusMiles: rradius, items: [] });
        }
        regions.get(rid)!.items.push(item);
      }
    }
    return Array.from(regions.values());
  }, [items, activeTab, activeRegions]);

  // Region-grouped venue rail data (Near You only). Each region contains its
  // distinct venues (with counts) so the rail can render section headers.
  // Seeded with all active regions so empty regions still appear.
  const regionVenueGroups = useMemo(() => {
    if (activeTab !== "Near You") return null;
    const regions = new Map<
      string,
      {
        id: string;
        cityName: string;
        radiusMiles: number;
        venues: { id: string; name: string; label?: string; count: number }[];
      }
    >();
    if (activeRegions) {
      for (const r of activeRegions) {
        regions.set(r.id, {
          id: r.id,
          cityName: r.cityName,
          radiusMiles: r.radiusMiles,
          venues: [],
        });
      }
    }
    if (items) {
      for (const item of items) {
        const rid = item.regionId ?? "__unknown";
        const rname = item.regionCityName ?? "Unknown";
        const rradius = item.regionRadiusMiles ?? 0;
        if (!regions.has(rid)) {
          regions.set(rid, { id: rid, cityName: rname, radiusMiles: rradius, venues: [] });
        }
        const region = regions.get(rid)!;
        const existing = region.venues.find((v) => v.id === item.venue.id);
        if (existing) {
          existing.count++;
        } else {
          region.venues.push({
            id: item.venue.id,
            name: item.venue.name,
            label: item.venue.city,
            count: 1,
          });
        }
      }
    }
    for (const r of regions.values()) {
      r.venues.sort((a, b) => b.count - a.count);
    }
    return Array.from(regions.values());
  }, [items, activeTab, activeRegions]);

  const totalCount = groupList.length;
  const isFollowed = activeTab === "Followed";
  const isArtists = activeTab === "Artists";
  const isNearby = activeTab === "Near You";
  const tabLabel = isFollowed
    ? "Followed venues"
    : isArtists
      ? "Followed artists"
      : "Nearby venues";
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

  const followModal = showFollowModal && (
    <VenueSearchModal
      onClose={() => setShowFollowModal(false)}
      onFollowed={handleVenueFollowed}
    />
  );

  const venueRail = (
    <VenueRail
      venues={groupList}
      regionGroups={isNearby ? regionVenueGroups : null}
      selected={selectedGroupId}
      onSelect={setSelectedGroupId}
      tabLabel={tabLabel}
      totalCount={isNearby ? (items?.length ?? 0) : totalCount}
      showFollowLink={isFollowed}
      onFollowVenue={handleFollowVenue}
      onUnfollowItem={(isFollowed || isArtists) ? handleUnfollowItem : undefined}
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
      </div>
    );
  }

  // For Near You with active regions, fall through to the main render even
  // when items is empty so region headers (and the ingest pending indicator)
  // still appear. For other tabs, show the empty state.
  const hasAnyRegionsToShow = activeTab === "Near You" && (regionGroups?.length ?? 0) > 0;
  if ((!items || items.length === 0) && !hasAnyRegionsToShow) {
    return (
      <div className="discover-main">
        {venueRail}
        <div className="discover-empty">
          <p className="discover-empty__text">{emptyMessage}</p>
        </div>
        {followModal}
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
          <div>Show date</div>
          <div>Kind</div>
          {groupBy === "region" && <div>Venue</div>}
          <div>{groupBy === "artist" ? "Venue" : "Headliner"}</div>
          <div>On sale</div>
          <div>Status</div>
          <div />
        </div>

        {/* Near You: grouped by region */}
        {isNearby && regionGroups ? (
          regionGroups.map((region) => {
            const collapsed = collapsedRegions.has(region.id);
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
                    className="discover-venue-group__name"
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6 }}
                    onClick={() => setCollapsedRegions((prev) => {
                      const next = new Set(prev);
                      if (next.has(region.id)) next.delete(region.id);
                      else next.add(region.id);
                      return next;
                    })}
                  >
                    {collapsed ? "▶" : "▼"} {region.cityName}
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
                {!collapsed && region.items.map((item) => (
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
            );
          })
        ) : (
          /* Followed venues / Artists: standard grouping */
          groups.map(({ group, items: groupItems }) => (
            <div key={group.id || "flat"} className="discover-venue-group">
              {/* Group header (only when "All" is selected) */}
              {showAllGrouped && group.id && (
                <div className="discover-venue-group__header">
                  <span className="discover-venue-group__name">
                    {group.name}
                  </span>
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
          ))
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
          x={regionContextMenu.x}
          y={regionContextMenu.y}
          items={[{
            label: "Unfollow region",
            danger: true,
            onClick: () => removeRegionMutation.mutate({ regionId: regionContextMenu.regionId }),
          }]}
          onClose={() => setRegionContextMenu(null)}
        />
      )}

      {followModal}
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
  { key: "Near You", label: "Near you" },
] as const;

export default function DiscoverPage() {
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
  const nearbyCount = nearbyItems?.length ?? 0;
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
          emptyMessage={nearbyFeed.data?.hasRegions ? "No announcements near you right now" : "Add a region in Preferences to see nearby shows"}
          watchedIds={watchedIds}
          onToggleWatch={handleToggleWatch}
          activeTab={activeTab}
          onVenueFollowed={handleVenueFollowed}
          groupBy="region"
          hasRegions={nearbyFeed.data?.hasRegions}
          pendingIngestRegionIds={pendingIngestRegionIds}
          activeRegions={activeRegions}
        />
      )}
    </div>
  );
}
