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
  support: string[] | null;
  showDate: string;
  onSaleDate: string | null;
  onSaleStatus: "announced" | "on_sale" | "sold_out";
  source: string;
  venue: {
    id: string;
    name: string;
    city: string;
  };
  reason?: string;
};

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

function formatOnSaleDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
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
}: {
  announcement: Announcement;
  isWatching: boolean;
  onToggleWatch: (id: string, watching: boolean) => void;
  showReason: boolean;
}) {
  const date = formatShowDateShort(announcement.showDate);
  const KindIcon = KIND_ICONS[announcement.kind];
  const isOnSale = announcement.onSaleStatus === "on_sale";
  const reasonText =
    announcement.reason && REASON_LABELS[announcement.reason]
      ? REASON_LABELS[announcement.reason]
      : announcement.reason || null;

  return (
    <div
      className={`discover-row discover-row--${announcement.kind} ${isWatching ? "discover-row--watched" : ""}`}
    >
      {/* Date */}
      <div>
        <div className="discover-row__date-main">
          {date.month} {date.day}
        </div>
        <div className="discover-row__date-sub">
          {date.year} &middot; {date.dow}
        </div>
      </div>

      {/* Kind */}
      <div
        className={`discover-row__kind discover-row__kind--${announcement.kind}`}
      >
        <KindIcon size={12} />
        {KIND_LABELS[announcement.kind]}
      </div>

      {/* Headliner */}
      <div className="discover-row__headliner-cell">
        <div className="discover-row__headliner">{announcement.headliner}</div>
        {announcement.support && announcement.support.length > 0 && (
          <div className="discover-row__support">
            + {announcement.support.join(", ")}
          </div>
        )}
        {showReason && reasonText && (
          <div className="discover-row__reason">{reasonText}</div>
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
        <button type="button" className="discover-tix-btn">
          <ArrowUpRight size={11} />
          Tix
        </button>
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
            {tabLabel === "Followed venues" ? "All followed" : "All nearby"}
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
}: {
  items: Announcement[] | undefined;
  isLoading: boolean;
  emptyMessage: string;
  watchedIds: Set<string>;
  onToggleWatch: (id: string, watching: boolean) => void;
  activeTab: string;
  onVenueFollowed: () => void;
}) {
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [showFollowModal, setShowFollowModal] = useState(false);

  // Extract unique venues with counts and neighborhoods
  const venueList = useMemo(() => {
    if (!items) return [];
    const seen = new Map<
      string,
      { id: string; name: string; label?: string; count: number }
    >();
    for (const item of items) {
      if (!seen.has(item.venue.id)) {
        seen.set(item.venue.id, {
          id: item.venue.id,
          name: item.venue.name,
          label: item.venue.city,
          count: 0,
        });
      }
      seen.get(item.venue.id)!.count++;
    }
    return Array.from(seen.values());
  }, [items]);

  // Filter items by selected venue
  const filteredItems = useMemo(() => {
    if (!items) return [];
    if (!selectedVenueId) return items;
    return items.filter((item) => item.venue.id === selectedVenueId);
  }, [items, selectedVenueId]);

  // Group by venue (when "All" is selected)
  const groups = useMemo(() => {
    if (selectedVenueId) {
      const v = venueList.find((v) => v.id === selectedVenueId) || {
        id: selectedVenueId,
        name: "",
        label: "",
        count: 0,
      };
      return [{ venue: v, items: filteredItems }];
    }
    return venueList.map((v) => ({
      venue: v,
      items: filteredItems.filter((item) => item.venue.id === v.id),
    }));
  }, [filteredItems, venueList, selectedVenueId]);

  const totalCount = items?.length ?? 0;
  const isFollowed = activeTab === "Followed";
  const tabLabel = isFollowed ? "Followed venues" : "Nearby venues";
  const showAllGrouped = selectedVenueId === null;

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
          onSelect={setSelectedVenueId}
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
          onSelect={setSelectedVenueId}
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
        venues={venueList}
        selected={selectedVenueId}
        onSelect={setSelectedVenueId}
        tabLabel={tabLabel}
        totalCount={totalCount}
        showFollowLink={isFollowed}
        onFollowVenue={handleFollowVenue}
      />

      {/* Mobile Chips */}
      <VenueChips
        venues={venueList}
        selected={selectedVenueId}
        onSelect={setSelectedVenueId}
        totalCount={totalCount}
      />

      {/* Feed */}
      <div className="discover-feed">
        {/* Column headers */}
        <div className="discover-col-headers">
          <div>Show date</div>
          <div>Kind</div>
          <div>Headliner</div>
          <div>On sale</div>
          <div>Status</div>
          <div />
        </div>

        {/* Grouped rows */}
        {groups.map((group) => (
          <div key={group.venue.id || "flat"} className="discover-venue-group">
            {/* Venue header (only when "All" is selected) */}
            {showAllGrouped && group.venue.id && (
              <div className="discover-venue-group__header">
                <Link
                  href={`/venues/${group.venue.id}`}
                  className="discover-venue-group__name discover-venue-group__name--link"
                >
                  {group.venue.name}
                </Link>
                <span className="discover-venue-group__meta">
                  {group.venue.label
                    ? group.venue.label.toLowerCase() + " · "
                    : ""}
                  {group.items.length} upcoming
                </span>
                <div className="discover-venue-group__rule" />
                <Link
                  href={`/venues/${group.venue.id}`}
                  className="discover-venue-group__link"
                >
                  venue page &rarr;
                </Link>
              </div>
            )}

            {/* Announcement rows */}
            {group.items.map((item) => (
              <AnnouncementRow
                key={item.id}
                announcement={item}
                isWatching={watchedIds.has(item.id)}
                onToggleWatch={onToggleWatch}
                showReason={showAllGrouped}
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
  { key: "Near You", label: "Near you" },
] as const;

export default function DiscoverPage() {
  const [activeTab, setActiveTab] = useState<string>("Followed");
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());

  const utils = trpc.useUtils();

  const followedFeed = trpc.discover.followedFeed.useQuery(
    { limit: 50 },
    { enabled: activeTab === "Followed" },
  );

  const nearbyFeed = trpc.discover.nearbyFeed.useQuery(
    { limit: 50 },
    { enabled: activeTab === "Near You" },
  );

  function handleVenueFollowed() {
    utils.discover.followedFeed.invalidate();
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
  const currentItems =
    activeTab === "Followed" ? followedItems : nearbyItems;
  const currentCount = currentItems?.length ?? 0;

  // Counts for tabs
  const followedCount = followedItems?.length ?? 0;
  const nearbyCount = nearbyItems?.length ?? 0;
  const tabCounts: Record<string, number> = {
    Followed: followedCount,
    "Near You": nearbyCount,
  };

  return (
    <div className="discover-page">
      {/* Header */}
      <header className="discover-header">
        <div>
          <div className="discover-header__subtitle">
            {currentCount} announcements &middot; daily 8am digest
          </div>
          <h1 className="discover-header__title">Discover</h1>
        </div>
        <div className="discover-header__location">
          <MapPin size={12} />
          nyc &middot; 30mi radius
          <span className="discover-header__location-sep">&middot;</span>
          3 regions
        </div>
      </header>

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
        />
      )}
    </div>
  );
}
