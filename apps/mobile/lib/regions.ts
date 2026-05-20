/**
 * Pure helpers for the user's saved regions.
 *
 * The web Preferences page (`apps/web/app/(app)/preferences/View.client.tsx`)
 * enforces the same 5-region cap server-side via `preferences.addRegion`. The
 * mobile Regions screen mirrors those rules, so the checks live here as pure
 * functions that both first-run and the in-app editor can call without
 * duplicating constants or input parsing.
 */

/**
 * Server-enforced cap on saved regions per user, mirroring the `>= 5` guard
 * in `preferences.addRegion`. Surface it to the client so the Add button can
 * disable before round-tripping a request that would 400.
 */
export const MAX_REGIONS = 5;

/** Default radius shown when the picker first opens. */
export const DEFAULT_RADIUS_MILES = 25;

/** Radius presets matching the first-run region picker. */
export const RADIUS_OPTIONS: readonly number[] = [15, 25, 50, 100] as const;

export interface RegionSummary {
  cityName: string;
  radiusMiles: number;
}

/**
 * Compact one-liner for a region row (e.g. "San Francisco · 25mi"). The
 * web app uses the same dot-separated pattern under the page heading.
 */
export function formatRegionSummary(region: RegionSummary): string {
  return `${region.cityName} · ${region.radiusMiles}mi`;
}

/**
 * `true` iff the user has fewer than `MAX_REGIONS` regions and can add
 * another. Negative or NaN inputs are treated as zero (the server is the
 * source of truth — this is a UI hint, not a security boundary).
 */
export function canAddRegion(currentCount: number): boolean {
  if (!Number.isFinite(currentCount) || currentCount < 0) return true;
  return currentCount < MAX_REGIONS;
}

/**
 * Raw input from the Add Region form (all strings — what the TextInput
 * surfaces).
 */
export interface RawRegionInput {
  cityName: string;
  latitude: number | string;
  longitude: number | string;
  radiusMiles: number | string;
}

export type ParsedRegionInput =
  | { ok: true; value: { cityName: string; latitude: number; longitude: number; radiusMiles: number } }
  | { ok: false; reason: RegionInputError };

export type RegionInputError =
  | 'missing_city'
  | 'invalid_latitude'
  | 'invalid_longitude'
  | 'invalid_radius';

/**
 * Validate + normalise the raw add-region inputs into the exact shape
 * `preferences.addRegion` expects. Centralises the parseInt/parseFloat
 * dance so the screen can stay focused on rendering.
 */
export function parseRegionInput(raw: RawRegionInput): ParsedRegionInput {
  const cityName = raw.cityName.trim();
  if (cityName === '') return { ok: false, reason: 'missing_city' };

  const latitude = typeof raw.latitude === 'number' ? raw.latitude : parseFloat(raw.latitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { ok: false, reason: 'invalid_latitude' };
  }

  const longitude =
    typeof raw.longitude === 'number' ? raw.longitude : parseFloat(raw.longitude);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { ok: false, reason: 'invalid_longitude' };
  }

  const radiusMiles =
    typeof raw.radiusMiles === 'number'
      ? raw.radiusMiles
      : parseInt(raw.radiusMiles, 10);
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0 || radiusMiles > 500) {
    return { ok: false, reason: 'invalid_radius' };
  }

  return {
    ok: true,
    value: { cityName, latitude, longitude, radiusMiles },
  };
}
