/**
 * Pure helpers for grouping Near You announcements by region.
 *
 * Used by the Discover page to drive both the right-side feed (announcements
 * grouped by region) and the left rail (venues grouped by region). Kept free
 * of React imports so they can be unit-tested under node:test.
 */

export type RegionableAnnouncement = {
  id: string;
  regionId?: string | null;
  regionCityName?: string | null;
  regionRadiusMiles?: number | null;
  venue: { id: string; name: string; city: string };
};

export type ActiveRegion = {
  id: string;
  cityName: string;
  radiusMiles: number;
};

export type RegionGroup<T extends RegionableAnnouncement> = {
  id: string;
  cityName: string;
  radiusMiles: number;
  items: T[];
};

export type RegionVenueGroup = {
  id: string;
  cityName: string;
  radiusMiles: number;
  venues: { id: string; name: string; label?: string; count: number }[];
};

const UNKNOWN_REGION_ID = '__unknown';

function getRegionKey(item: RegionableAnnouncement): string {
  return item.regionId ?? UNKNOWN_REGION_ID;
}

/**
 * Group announcements into per-region buckets for the right-side feed.
 * When `selectedVenueId` is provided, only that venue's items are included
 * (the rest of the regions still render so empty headers can be shown).
 *
 * The map is seeded from `activeRegions` so a just-added region with no
 * items yet still renders an empty header (its ingest indicator hangs off
 * that header).
 */
export function groupAnnouncementsByRegion<T extends RegionableAnnouncement>(
  items: T[] | undefined,
  activeRegions: ActiveRegion[] | undefined,
  selectedVenueId: string | null = null,
): RegionGroup<T>[] {
  const filtered = selectedVenueId
    ? (items ?? []).filter((i) => i.venue.id === selectedVenueId)
    : items ?? [];

  const regions = new Map<string, RegionGroup<T>>();
  if (activeRegions) {
    for (const r of activeRegions) {
      regions.set(r.id, {
        id: r.id,
        cityName: r.cityName,
        radiusMiles: r.radiusMiles,
        items: [],
      });
    }
  }

  for (const item of filtered) {
    const rid = getRegionKey(item);
    if (!regions.has(rid)) {
      regions.set(rid, {
        id: rid,
        cityName: item.regionCityName ?? 'Unknown',
        radiusMiles: item.regionRadiusMiles ?? 0,
        items: [],
      });
    }
    regions.get(rid)!.items.push(item);
  }

  return Array.from(regions.values());
}

/**
 * Build the rail's region-grouped venue list. Always uses the unfiltered
 * item set so the rail counts don't change when the user clicks a venue.
 */
export function groupVenuesByRegion<T extends RegionableAnnouncement>(
  items: T[] | undefined,
  activeRegions: ActiveRegion[] | undefined,
): RegionVenueGroup[] {
  const regions = new Map<string, RegionVenueGroup>();
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
      const rid = getRegionKey(item);
      if (!regions.has(rid)) {
        regions.set(rid, {
          id: rid,
          cityName: item.regionCityName ?? 'Unknown',
          radiusMiles: item.regionRadiusMiles ?? 0,
          venues: [],
        });
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
}
