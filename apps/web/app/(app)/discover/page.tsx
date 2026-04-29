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
}: {
  announcement: Announcement;
  isWatching: boolean;
  onToggleWatch: (id: string, watching: boolean) => void;
  showReason: boolean;
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

      {/* Headliner */}
      <div className="discover-row__headliner-cell">
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

function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

type VenueSearchAction =
  | { kind: "follow"; venueId: string }
  | { kind: "createAndFollow"; placeId: string };

function VenueSearchModal({
  onClose,
  onFollowed,
}: {
  onClose: () => void;
  onFollowed: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounced(query.trim(), 200);

  const searchResults = trpc.venues.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 },
  );

  const placesResults = trpc.enrichment.searchPlaces.useQuery(
    { query: debouncedQuery, types: "venue" },
    { enabled: debouncedQuery.length >= 2 },
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

  const localVenues = useMemo(() => searchResults.data ?? [], [searchResults.data]);
  const filteredPlaces = useMemo(() => {
    const places = placesResults.data ?? [];
    const localPlaceIds = new Set(
      localVenues.map((v) => v.googlePlaceId).filter(Boolean) as string[],
    );
    return places.filter((p) => !localPlaceIds.has(p.placeId));
  }, [placesResults.data, localVenues]);
  const isPending = followMutation.isPending || createAndFollow.isPending;

  const actions = useMemo<VenueSearchAction[]>(
    () => [
      ...localVenues.map((v): VenueSearchAction => ({ kind: "follow", venueId: v.id })),
      ...filteredPlaces.map((p): VenueSearchAction => ({ kind: "createAndFollow", placeId: p.placeId })),
    ],
    [localVenues, filteredPlaces],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [actions.length]);

  const select = (action: VenueSearchAction) => {
    if (isPending) return;
    if (action.kind === "follow") {
      followMutation.mutate({ venueId: action.venueId });
    } else {
      createAndFollow.mutate({ placeId: action.placeId });
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (actions.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % actions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + actions.length) % actions.length);
      } else if (e.key === "Enter") {
        const action = actions[activeIndex];
        if (action) {
          e.preventDefault();
          select(action);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, activeIndex, onClose, isPending]);

  const venuesStart = 0;
  const placesStart = localVenues.length;
  const showResults = debouncedQuery.length >= 2;
  const isFetching = searchResults.isFetching || placesResults.isFetching;
  const hasNoResults =
    showResults && !isFetching && localVenues.length === 0 && filteredPlaces.length === 0;

  return (
    <div
      className="discover-modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="discover-modal"
        onClick={(e) => e.stopPropagation()}
        data-testid="venue-follow-modal"
      >
        <div className="discover-modal__input-row">
          <Search size={14} className="discover-modal__input-icon" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search venues…"
            className="discover-modal__input"
            data-testid="venue-follow-input"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={onClose}
            className="discover-modal__close"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="discover-modal__body">
          {!showResults ? (
            <div className="discover-modal__empty">
              Type at least 2 characters to search
            </div>
          ) : isFetching && actions.length === 0 ? (
            <div className="discover-modal__empty">Searching…</div>
          ) : hasNoResults ? (
            <div className="discover-modal__empty">No venues found</div>
          ) : (
            <div className="discover-modal__results">
              {localVenues.length > 0 && (
                <Section title="Venues">
                  {localVenues.map((venue, i) => {
                    const idx = venuesStart + i;
                    return (
                      <ResultRow
                        key={venue.id}
                        active={idx === activeIndex}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => select({ kind: "follow", venueId: venue.id })}
                        disabled={isPending}
                        primary={venue.name}
                        secondary={[venue.city, venue.stateRegion]
                          .filter(Boolean)
                          .join(", ")}
                        meta="Follow"
                        dataTestId="venue-follow-result-db"
                      />
                    );
                  })}
                </Section>
              )}
              {filteredPlaces.length > 0 && (
                <Section title="From Google Places">
                  {filteredPlaces.map((place, i) => {
                    const idx = placesStart + i;
                    return (
                      <ResultRow
                        key={place.placeId}
                        active={idx === activeIndex}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() =>
                          select({ kind: "createAndFollow", placeId: place.placeId })
                        }
                        disabled={isPending}
                        primary={place.displayName}
                        secondary={place.formattedAddress}
                        meta="Add & follow"
                        dataTestId="venue-follow-result-place"
                      />
                    );
                  })}
                </Section>
              )}
            </div>
          )}
        </div>

        <div className="discover-modal__footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> follow</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="discover-modal__section">
      <div className="discover-modal__section-title">{title}</div>
      <div>{children}</div>
    </div>
  );
}

function ResultRow({
  active,
  onClick,
  onMouseEnter,
  disabled,
  primary,
  secondary,
  meta,
  dataTestId,
}: {
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  disabled: boolean;
  primary: string;
  secondary: string;
  meta: string;
  dataTestId?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active && ref.current) {
      ref.current.scrollIntoView({ block: "nearest" });
    }
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      disabled={disabled}
      className={`discover-modal__row${active ? " discover-modal__row--active" : ""}`}
      data-testid={dataTestId}
    >
      <span className="discover-modal__row-icon">
        <MapPin size={13} />
      </span>
      <span className="discover-modal__row-text">
        <span className="discover-modal__row-primary">{primary}</span>
        <span className="discover-modal__row-secondary">{secondary}</span>
      </span>
      <span className="discover-modal__row-meta">{meta}</span>
    </button>
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

  // Counts for tabs
  const followedCount = followedItems?.length ?? 0;
  const nearbyCount = nearbyItems?.length ?? 0;
  const artistsCount = artistItems?.length ?? 0;
  const tabCounts: Record<string, number> = {
    Followed: followedCount,
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
