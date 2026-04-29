"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { type ShowKind } from "@/components/design-system";
import {
  Music,
  Clapperboard,
  Laugh,
  Tent,
  MapPin,
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
// Types inferred from the tRPC router
// ---------------------------------------------------------------------------

type Announcement = {
  id: string;
  venueId: string;
  kind: ShowKind;
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
  ShowKind,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  concert: Music,
  theatre: Clapperboard,
  comedy: Laugh,
  festival: Tent,
};

const KIND_LABELS: Record<ShowKind, string> = {
  concert: "Concert",
  theatre: "Theatre",
  comedy: "Comedy",
  festival: "Festival",
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
  groupBy: "venue" | "artist";
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
      className={`discover-row discover-row--${announcement.kind} ${isWatching ? "discover-row--watched" : ""} ${runMode ? "discover-row--run" : ""}`}
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
        <WatchButton
          announcementId={announcement.id}
          isWatching={isWatching}
          onToggle={onToggleWatch}
        />
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
  selected,
  onSelect,
  tabLabel,
  totalCount,
  showFollowLink,
  onFollowVenue,
}: {
  venues: {
    id: string;
    name: string;
    label?: string;
    count: number;
  }[];
  selected: string | null;
  onSelect: (venueId: string | null) => void;
  tabLabel: string;
  totalCount: number;
  showFollowLink: boolean;
  onFollowVenue?: () => void;
}) {
  return (
    <aside className="discover-rail">
      <div className="discover-rail__title">{tabLabel}</div>

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

      {/* Per-venue items */}
      {venues.map((v) => (
        <button
          key={v.id}
          type="button"
          className={`discover-rail__item ${selected === v.id ? "discover-rail__item--active" : ""}`}
          onClick={() => onSelect(selected === v.id ? null : v.id)}
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
}: {
  items: Announcement[] | undefined;
  isLoading: boolean;
  emptyMessage: string;
  watchedIds: Set<string>;
  onToggleWatch: (id: string, watching: boolean) => void;
  activeTab: string;
  onVenueFollowed: () => void;
  groupBy: "venue" | "artist";
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showFollowModal, setShowFollowModal] = useState(false);

  function getGroupKey(item: Announcement): string | null {
    return groupBy === "artist" ? item.headlinerPerformerId : item.venue.id;
  }

  // Extract unique groups (venues or artists) with counts
  const groupList = useMemo(() => {
    if (!items) return [];
    const seen = new Map<
      string,
      { id: string; name: string; label?: string; count: number }
    >();
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
    return Array.from(seen.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, groupBy]);

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

  const totalCount = groupList.length;
  const isFollowed = activeTab === "Followed";
  const isArtists = activeTab === "Artists";
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

  if (isLoading) {
    return (
      <div className="discover-main">
        <VenueRail
          venues={[]}
          selected={null}
          onSelect={setSelectedGroupId}
          tabLabel={tabLabel}
          totalCount={0}
          showFollowLink={isFollowed}
          onFollowVenue={handleFollowVenue}
        />
        <div className="discover-empty">
          <div className="discover-loading">
            <div className="discover-loading__dot" />
            <div className="discover-loading__dot" />
            <div className="discover-loading__dot" />
          </div>
        </div>
        {followModal}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="discover-main">
        <VenueRail
          venues={[]}
          selected={null}
          onSelect={setSelectedGroupId}
          tabLabel={tabLabel}
          totalCount={0}
          showFollowLink={isFollowed}
          onFollowVenue={handleFollowVenue}
        />
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
      <VenueRail
        venues={groupList}
        selected={selectedGroupId}
        onSelect={setSelectedGroupId}
        tabLabel={tabLabel}
        totalCount={totalCount}
        showFollowLink={isFollowed}
        onFollowVenue={handleFollowVenue}
      />

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
        <div className="discover-col-headers">
          <div>Show date</div>
          <div>Kind</div>
          <div>{groupBy === "artist" ? "Venue" : "Headliner"}</div>
          <div>On sale</div>
          <div>Status</div>
          <div />
        </div>

        {/* Grouped rows */}
        {groups.map(({ group, items: groupItems }) => (
          <div key={group.id || "flat"} className="discover-venue-group">
            {/* Group header (only when "All" is selected) */}
            {showAllGrouped && group.id && (
              <div className="discover-venue-group__header">
                <Link
                  href={`/${groupRoute}/${group.id}`}
                  className="discover-venue-group__name discover-venue-group__name--link"
                >
                  {group.name}
                </Link>
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
        ))}

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
      {followModal}
    </div>
  );
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

  const utils = trpc.useUtils();

  const followedFeed = trpc.discover.followedFeed.useQuery(
    { limit: 50 },
    { enabled: activeTab === "Followed" },
  );

  const nearbyFeed = trpc.discover.nearbyFeed.useQuery(
    { limit: 50 },
    { enabled: activeTab === "Near You" },
  );

  const followedArtistsFeed = trpc.discover.followedArtistsFeed.useQuery(
    { limit: 50 },
    { enabled: activeTab === "Artists" },
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
    utils.discover.followedFeed.invalidate();
    utils.discover.nearbyFeed.invalidate();
    utils.venues.followed.invalidate();
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
          groupBy="venue"
        />
      )}
    </div>
  );
}
