/**
 * Shared region bounding-box math used by the discover feed,
 * preferences cleanup, and the daily-digest filter. Approximates
 * each region as a lat/lng-aligned square — 69 mi ≈ 1° lat, scaled
 * by cos(lat) for longitude.
 */

export interface RegionBbox {
  latitude: number;
  longitude: number;
  radiusMiles: number;
}

export interface BboxBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function regionBbox(region: RegionBbox): BboxBounds {
  const latDelta = region.radiusMiles / 69.0;
  const lngDelta =
    region.radiusMiles / (69.0 * Math.cos((region.latitude * Math.PI) / 180));
  return {
    minLat: region.latitude - latDelta,
    maxLat: region.latitude + latDelta,
    minLng: region.longitude - lngDelta,
    maxLng: region.longitude + lngDelta,
  };
}

export function isPointInBbox(
  lat: number,
  lng: number,
  bounds: BboxBounds,
): boolean {
  return (
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng
  );
}

export function isPointInRegion(
  lat: number,
  lng: number,
  region: RegionBbox,
): boolean {
  return isPointInBbox(lat, lng, regionBbox(region));
}

export function isPointInAnyRegion(
  lat: number,
  lng: number,
  regions: ReadonlyArray<RegionBbox>,
): boolean {
  for (const r of regions) {
    if (isPointInRegion(lat, lng, r)) return true;
  }
  return false;
}
