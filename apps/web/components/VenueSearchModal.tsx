"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface VenueSearchModalProps {
  onClose: () => void;
  onFollowed: () => void;
}

export function VenueSearchModal({
  onClose,
  onFollowed,
}: VenueSearchModalProps) {
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
  const localIds = new Set(
    localVenues.map((v) => v.googlePlaceId).filter(Boolean),
  );
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
            <div
              className="discover-modal__hint"
              style={{ borderBottom: "1px solid var(--rule)" }}
            >
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
                <div className="discover-modal__result-name">
                  {place.displayName}
                </div>
                <div className="discover-modal__result-meta">
                  {place.formattedAddress}
                </div>
              </div>
              <div className="discover-modal__result-action">
                <Plus size={12} />
                Follow
              </div>
            </button>
          ))}
          {query.length >= 2 &&
            !searchResults.isLoading &&
            localVenues.length === 0 &&
            filteredPlaces.length === 0 && (
              <div className="discover-modal__hint">No venues found</div>
            )}
        </div>
      </div>
    </div>
  );
}
