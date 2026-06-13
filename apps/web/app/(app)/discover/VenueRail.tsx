"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import { ContextMenu } from "@/components/ContextMenu";
import { FollowArtistSearch } from "@/components/discover/FollowArtistSearch";

/**
 * Left-rail filter for the Discover feed.
 *
 * Renders the active follow-list (venues, artists, or region-grouped
 * venues) with per-item counts, optional pending-ingest indicators,
 * and right-click context menus for unfollow. The "All" row clears
 * the filter; clicking an active row clears it too.
 *
 * Each Discover tab supplies a different shape:
 *   - Followed venues → flat `venues` list, `tabLabel="Followed venues"`
 *   - Followed artists → flat `venues` list reused as performer list
 *   - Followed regions → `regionGroups` with venue children
 */
export function VenueRail({
  venues,
  regionGroups,
  selected,
  onSelect,
  tabLabel,
  totalCount,
  showFollowLink,
  onFollowVenue,
  addVenueDisabled,
  addVenueHint,
  onUnfollowItem,
  showAddRegion,
  onAddRegion,
  addRegionDisabled,
  addRegionHint,
  onUnfollowRegion,
  showArtistSearch,
  addArtistDisabled,
  addArtistHint,
  onArtistFollowed,
  pendingItemIds,
  pendingRegionIds,
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
  addVenueDisabled?: boolean;
  addVenueHint?: string;
  onUnfollowItem?: (id: string) => void;
  showAddRegion?: boolean;
  onAddRegion?: () => void;
  addRegionDisabled?: boolean;
  addRegionHint?: string;
  onUnfollowRegion?: (regionId: string) => void;
  showArtistSearch?: boolean;
  addArtistDisabled?: boolean;
  addArtistHint?: string;
  onArtistFollowed?: (performerId: string) => void;
  pendingItemIds?: Set<string>;
  pendingRegionIds?: Set<string>;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [railRegionContextMenu, setRailRegionContextMenu] = useState<{ x: number; y: number; regionId: string } | null>(null);
  const [collapsedRailRegions, setCollapsedRailRegions] = useState<Set<string>>(new Set());
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
          <button
            type="button"
            className="discover-rail__follow-link"
            onClick={onFollowVenue}
            disabled={addVenueDisabled}
            title={addVenueHint}
          >
            <Plus size={11} />
            Follow another venue
          </button>
          {addVenueHint && (
            <div className="discover-rail__follow-hint">{addVenueHint}</div>
          )}
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
          <FollowArtistSearch
            variant="rail"
            atCap={addArtistDisabled}
            capHint={addArtistHint}
            onFollowed={onArtistFollowed}
          />
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
            const regionPending =
              pendingRegionIds?.has(region.id) ?? false;
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
                    {regionPending && (
                      <span
                        aria-label="Loading shows"
                        className="discover-ingest-dot discover-ingest-dot--inline"
                        data-testid="rail-region-ingest-dot"
                      />
                    )}
                  </span>
                  <span className="discover-rail__section-meta">
                    {region.radiusMiles}mi
                  </span>
                </button>
                {!collapsed && (
                  <div id={`rail-region-${region.id}`}>
                    {region.venues.map((v) => {
                      const itemPending =
                        pendingItemIds?.has(v.id) ?? false;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          className={`discover-rail__item ${selected === v.id ? "discover-rail__item--active" : ""}`}
                          onClick={() => onSelect(selected === v.id ? null : v.id)}
                          onContextMenu={(e) => handleContextMenu(e, v.id)}
                        >
                          <div className="discover-rail__item-body">
                            <div className="discover-rail__item-name">
                              {v.name}
                              {itemPending && (
                                <span
                                  aria-label="Loading shows"
                                  className="discover-ingest-dot discover-ingest-dot--inline"
                                />
                              )}
                            </div>
                            {v.label && (
                              <div className="discover-rail__item-nbhd">
                                {v.label.toLowerCase()}
                              </div>
                            )}
                          </div>
                          <div className="discover-rail__item-count">{v.count}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        : venues.map((v) => {
            const itemPending = pendingItemIds?.has(v.id) ?? false;
            return (
              <button
                key={v.id}
                type="button"
                className={`discover-rail__item ${selected === v.id ? "discover-rail__item--active" : ""}`}
                onClick={() => onSelect(selected === v.id ? null : v.id)}
                onContextMenu={(e) => handleContextMenu(e, v.id)}
              >
                <div className="discover-rail__item-body">
                  <div className="discover-rail__item-name">
                    {v.name}
                    {itemPending && (
                      <span
                        aria-label="Loading shows"
                        className="discover-ingest-dot discover-ingest-dot--inline"
                        data-testid="rail-item-ingest-dot"
                      />
                    )}
                  </div>
                  {v.label && (
                    <div className="discover-rail__item-nbhd">
                      {v.label.toLowerCase()}
                    </div>
                  )}
                </div>
                <div className="discover-rail__item-count">{v.count}</div>
              </button>
            );
          })}

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
