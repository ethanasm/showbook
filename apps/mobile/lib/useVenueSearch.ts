/**
 * Hybrid venue typeahead helper for the Add/Edit Show forms.
 *
 * The previous implementation only queried `venues.search` (local DB
 * ILIKE on the venue name), which couldn't find Broadway theatres or
 * any venue the user hadn't already logged. This helper fires
 * `venues.search` and `enrichment.searchPlaces` in parallel, dedupes
 * Google Places hits that already map to a local venue (by
 * `googlePlaceId`), and exposes a `resolvePlace` call that materializes
 * a Places suggestion into a real venue via `venues.createFromPlace`.
 *
 * The hook is stateful (suggestions + loading) so the parent screen
 * only has to pipe `runSearch` into VenueTypeahead's `onSearch` and
 * pass the suggestions back. Two unrelated calls staying in lockstep
 * is what `setVenueResults` / `setVenueLoading` used to do
 * inline in `add/form.tsx` and `show/[id]/edit.tsx`.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { VenueSuggestion } from '../components/VenueTypeahead';

/**
 * Subset of the tRPC vanilla client we depend on. Typing as `unknown`
 * avoids dragging in the full router type — these are exercised by the
 * mobile tests through a hand-rolled fake, and at runtime the actual
 * client is type-checked at the call site.
 */
export interface VenueSearchTrpcClient {
  venues: {
    search: {
      query: (input: { query: string }) => Promise<
        Array<{
          id: string;
          name: string;
          city: string | null;
          stateRegion: string | null;
          country: string | null;
          googlePlaceId: string | null;
        }>
      >;
    };
    createFromPlace: {
      mutate: (input: { placeId: string }) => Promise<{
        id: string;
        name: string;
        city: string | null;
        stateRegion: string | null;
        country: string | null;
      }>;
    };
  };
  enrichment: {
    searchPlaces: {
      query: (input: { query: string; types?: 'venue' | 'city' }) => Promise<
        Array<{
          placeId: string;
          displayName: string;
          formattedAddress: string;
        }>
      >;
    };
  };
}

export interface UseVenueSearch {
  suggestions: VenueSuggestion[];
  loading: boolean;
  /** Fire the parallel local + Places lookup for the given query. */
  runSearch: (q: string) => void;
  /**
   * Materialize a Google Places suggestion into a real venue. Throws
   * if the underlying mutation fails so the caller can toast.
   */
  resolvePlace: (placeId: string) => Promise<{
    id: string;
    name: string;
    city: string | null;
    stateRegion: string | null;
    country: string | null;
  }>;
}

/**
 * Merge local DB venues and Google Places suggestions into a single
 * typeahead list. Local venues come first (they're what the user has
 * touched before); Google Places hits whose `placeId` is already
 * represented by a local venue's `googlePlaceId` are dropped so the
 * user doesn't see the same place twice. Exported for unit testing.
 */
export function mergeVenueSuggestions(
  local: Array<{
    id: string;
    name: string;
    city: string | null;
    stateRegion: string | null;
    country: string | null;
    googlePlaceId: string | null;
  }>,
  places: Array<{ placeId: string; displayName: string; formattedAddress: string }>,
): VenueSuggestion[] {
  const localPlaceIds = new Set(
    local.map((r) => r.googlePlaceId).filter((v): v is string => Boolean(v)),
  );
  const localSuggestions: VenueSuggestion[] = local.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    stateRegion: r.stateRegion,
    country: r.country,
  }));
  const placesSuggestions: VenueSuggestion[] = places
    .filter((p) => !localPlaceIds.has(p.placeId))
    .map((p) => ({
      id: `place:${p.placeId}`,
      name: p.displayName,
      placeId: p.placeId,
      formattedAddress: p.formattedAddress ? p.formattedAddress : undefined,
    }));
  return [...localSuggestions, ...placesSuggestions];
}

export function useVenueSearch(client: VenueSearchTrpcClient): UseVenueSearch {
  const [suggestions, setSuggestions] = useState<VenueSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  // A monotonically increasing token guards against out-of-order
  // responses: if the user keeps typing, only the most recent
  // `runSearch` should win when its results finally arrive.
  const tokenRef = useRef(0);

  const runSearch = useCallback(
    (q: string) => {
      const myToken = ++tokenRef.current;
      setLoading(true);
      Promise.allSettled([
        client.venues.search.query({ query: q }),
        client.enrichment.searchPlaces.query({ query: q, types: 'venue' }),
      ])
        .then(([localRes, placesRes]) => {
          if (myToken !== tokenRef.current) return;
          const local = localRes.status === 'fulfilled' ? localRes.value : [];
          const places = placesRes.status === 'fulfilled' ? placesRes.value : [];
          // Both calls can fail (offline, rate-limited, missing API key);
          // we still want to show whichever side succeeded.
          setSuggestions(
            mergeVenueSuggestions(
              Array.isArray(local) ? local : [],
              Array.isArray(places) ? places : [],
            ),
          );
        })
        .finally(() => {
          if (myToken === tokenRef.current) setLoading(false);
        });
    },
    [client],
  );

  const resolvePlace = useCallback(
    async (placeId: string) => {
      return client.venues.createFromPlace.mutate({ placeId });
    },
    [client],
  );

  return useMemo(
    () => ({ suggestions, loading, runSearch, resolvePlace }),
    [suggestions, loading, runSearch, resolvePlace],
  );
}
