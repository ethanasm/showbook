"use client";

import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

/**
 * Wraps the `enrichment.searchPlaces` query with the debounce + the
 * `enrichment.placeDetails` fetch helper that VenueSearchModal,
 * RegionSearchModal, and preferences' inline `AddRegionForm` were each
 * re-implementing with ad-hoc setTimeout/clearTimeout refs.
 *
 * Caller owns the input text and the selection state; the hook owns
 * the debounce, the query, and the `useUtils().enrichment.placeDetails.fetch`
 * imperative call.
 */
export interface UsePlaceSearchOptions {
  types?: "city" | "venue";
  debounceMs?: number;
  enabled?: boolean;
}

export function usePlaceSearch(query: string, opts: UsePlaceSearchOptions = {}) {
  const debouncedQuery = useDebouncedValue(query, opts.debounceMs ?? 400);
  const utils = trpc.useUtils();
  const enabledByCaller = opts.enabled ?? true;

  const search = trpc.enrichment.searchPlaces.useQuery(
    { query: debouncedQuery, types: opts.types ?? "city" },
    {
      enabled: enabledByCaller && debouncedQuery.length >= 2,
      retry: false,
    },
  );

  const fetchPlaceDetails = useCallback(
    (placeId: string) => utils.enrichment.placeDetails.fetch({ placeId }),
    [utils],
  );

  // `isSettling` is true while the user is mid-keystroke and the debounce
  // hasn't caught up to the live `query` yet. Consumers should treat this
  // the same as `isSearching` for UI gating so stale results from the
  // previous debounce don't flash, and "no results" empty states don't
  // appear before the new request has even fired.
  const isSettling =
    enabledByCaller && query !== debouncedQuery && query.length >= 2;

  return {
    /**
     * The live (not-debounced) input value the hook was called with.
     * Exposed so consumers can gate UI on whether the debounce has
     * caught up: `query === debouncedQuery`.
     */
    query,
    debouncedQuery,
    results: search.data ?? [],
    isSearching: search.isLoading || isSettling,
    isSettling,
    isSearchError: search.isError,
    fetchPlaceDetails,
  };
}
