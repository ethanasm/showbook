"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  SegmentedControl,
  KindBadge,
  type ShowKind,
} from "@/components/design-system";
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
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatShowDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const ON_SALE_LABELS: Record<string, string> = {
  announced: "Announced",
  on_sale: "On Sale",
  sold_out: "Sold Out",
};

// ---------------------------------------------------------------------------
// On-Sale Status Badge
// ---------------------------------------------------------------------------

function OnSaleBadge({
  status,
}: {
  status: "announced" | "on_sale" | "sold_out";
}) {
  return (
    <span className={`on-sale-badge on-sale-badge--${status}`}>
      {ON_SALE_LABELS[status]}
    </span>
  );
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

  function handleClick() {
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
      className={`watch-btn ${isWatching ? "watch-btn--watching" : ""}`}
      onClick={handleClick}
      disabled={isPending}
    >
      {isWatching ? "Watching" : "Watch"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Announcement Card
// ---------------------------------------------------------------------------

function AnnouncementCard({
  announcement,
  isWatching,
  onToggleWatch,
}: {
  announcement: Announcement;
  isWatching: boolean;
  onToggleWatch: (id: string, watching: boolean) => void;
}) {
  return (
    <div className="announcement-card">
      <div className="announcement-card__top">
        <KindBadge kind={announcement.kind} />
        <OnSaleBadge status={announcement.onSaleStatus} />
      </div>
      <div className="announcement-card__headliner">
        {announcement.headliner}
      </div>
      {announcement.support && announcement.support.length > 0 && (
        <div className="announcement-card__support">
          {announcement.support.join(", ")}
        </div>
      )}
      <div className="announcement-card__bottom">
        <span className="announcement-card__date">
          {formatShowDate(announcement.showDate)}
        </span>
        <WatchButton
          announcementId={announcement.id}
          isWatching={isWatching}
          onToggle={onToggleWatch}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Venue Filter (desktop rail + mobile chips)
// ---------------------------------------------------------------------------

function VenueFilter({
  venues,
  selected,
  onSelect,
}: {
  venues: { id: string; name: string }[];
  selected: string | null;
  onSelect: (venueId: string | null) => void;
}) {
  if (venues.length === 0) return null;

  return (
    <>
      {/* Desktop: sidebar rail */}
      <aside className="venue-filter-rail">
        <div className="venue-filter-rail__title">Venues</div>
        <button
          type="button"
          className={`venue-filter-rail__item ${selected === null ? "venue-filter-rail__item--active" : ""}`}
          onClick={() => onSelect(null)}
        >
          All
        </button>
        {venues.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`venue-filter-rail__item ${selected === v.id ? "venue-filter-rail__item--active" : ""}`}
            onClick={() => onSelect(selected === v.id ? null : v.id)}
          >
            {v.name}
          </button>
        ))}
      </aside>

      {/* Mobile: horizontal chip row */}
      <div className="venue-filter-chips">
        <button
          type="button"
          className={`venue-chip ${selected === null ? "venue-chip--active" : ""}`}
          onClick={() => onSelect(null)}
        >
          All
        </button>
        {venues.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`venue-chip ${selected === v.id ? "venue-chip--active" : ""}`}
            onClick={() => onSelect(selected === v.id ? null : v.id)}
          >
            {v.name}
          </button>
        ))}
      </div>
    </>
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
  showVenueFilter,
}: {
  items: Announcement[] | undefined;
  isLoading: boolean;
  emptyMessage: string;
  watchedIds: Set<string>;
  onToggleWatch: (id: string, watching: boolean) => void;
  showVenueFilter: boolean;
}) {
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);

  // Extract unique venues
  const uniqueVenues = useMemo(() => {
    if (!items) return [];
    const seen = new Map<string, { id: string; name: string }>();
    for (const item of items) {
      if (!seen.has(item.venue.id)) {
        seen.set(item.venue.id, { id: item.venue.id, name: item.venue.name });
      }
    }
    return Array.from(seen.values());
  }, [items]);

  // Filter items by selected venue
  const filteredItems = useMemo(() => {
    if (!items) return [];
    if (!selectedVenueId) return items;
    return items.filter((item) => item.venue.id === selectedVenueId);
  }, [items, selectedVenueId]);

  // Group by venue
  const groupedByVenue = useMemo(() => {
    const groups = new Map<
      string,
      { venue: { id: string; name: string; city: string }; items: Announcement[] }
    >();
    for (const item of filteredItems) {
      const key = item.venue.id;
      if (!groups.has(key)) {
        groups.set(key, { venue: item.venue, items: [] });
      }
      groups.get(key)!.items.push(item);
    }
    return Array.from(groups.values());
  }, [filteredItems]);

  if (isLoading) {
    return (
      <div className="discover-empty">
        <div className="discover-loading">
          <div className="discover-loading__dot" />
          <div className="discover-loading__dot" />
          <div className="discover-loading__dot" />
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="discover-empty">
        <p className="discover-empty__text">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="feed-layout">
      {showVenueFilter && (
        <VenueFilter
          venues={uniqueVenues}
          selected={selectedVenueId}
          onSelect={setSelectedVenueId}
        />
      )}
      <div className="feed-content">
        {groupedByVenue.map((group) => (
          <section key={group.venue.id} className="venue-group">
            <h3 className="venue-group__header">
              {group.venue.name}
              <span className="venue-group__city">{group.venue.city}</span>
            </h3>
            <div className="venue-group__cards">
              {group.items.map((item) => (
                <AnnouncementCard
                  key={item.id}
                  announcement={item}
                  isWatching={watchedIds.has(item.id)}
                  onToggleWatch={onToggleWatch}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const TABS = ["Followed", "Near You"] as const;

export default function DiscoverPage() {
  const [activeTab, setActiveTab] = useState<string>("Followed");
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());

  const followedFeed = trpc.discover.followedFeed.useQuery(
    { limit: 50 },
    { enabled: activeTab === "Followed" },
  );

  const nearbyFeed = trpc.discover.nearbyFeed.useQuery(
    { limit: 50 },
    { enabled: activeTab === "Near You" },
  );

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

  return (
    <div className="discover-page">
      <header className="discover-header">
        <h1 className="discover-title">Discover</h1>
        <SegmentedControl
          options={[...TABS]}
          selected={activeTab}
          onChange={setActiveTab}
        />
      </header>

      {activeTab === "Followed" && (
        <FeedSection
          items={followedFeed.data?.items as Announcement[] | undefined}
          isLoading={followedFeed.isLoading}
          emptyMessage="No announcements from followed venues"
          watchedIds={watchedIds}
          onToggleWatch={handleToggleWatch}
          showVenueFilter={true}
        />
      )}

      {activeTab === "Near You" && (
        <FeedSection
          items={nearbyFeed.data?.items as Announcement[] | undefined}
          isLoading={nearbyFeed.isLoading}
          emptyMessage="Add a region in Preferences to see nearby shows"
          watchedIds={watchedIds}
          onToggleWatch={handleToggleWatch}
          showVenueFilter={false}
        />
      )}
    </div>
  );
}
