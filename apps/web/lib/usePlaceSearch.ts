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

  const search = trpc.enrichment.searchPlaces.useQuery(
    { query: debouncedQuery, types: opts.types ?? "city" },
    {
      enabled: (opts.enabled ?? true) && debouncedQuery.length >= 2,
      retry: false,
    },
  );

  const fetchPlaceDetails = useCallback(
    (placeId: string) => utils.enrichment.placeDetails.fetch({ placeId }),
    [utils],
  );

  return {
    debouncedQuery,
    results: search.data ?? [],
    isSearching: search.isLoading,
    isSearchError: search.isError,
    fetchPlaceDetails,
  };
}
