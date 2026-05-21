"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface VenueFollowModalProps {
  onClose: () => void;
  onFollowed: () => void;
}

export function VenueFollowModal({ onClose, onFollowed }: VenueFollowModalProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const searchResults = trpc.venues.search.useQuery({ query }, { enabled: query.length >= 2 });
  const placesResults = trpc.enrichment.searchPlaces.useQuery(
    { query, types: "venue" },
    { enabled: query.length >= 2, retry: false },
  );
  const followMutation = trpc.venues.follow.useMutation({
    meta: { successToast: "Following venue" },
    onSuccess: () => { setQuery(""); onFollowed(); },
  });
  const createAndFollow = trpc.venues.createFromPlace.useMutation({
    onSuccess: (venue) => { followMutation.mutate({ venueId: venue.id }); },
  });

  useEffect(() => { inputRef.current?.focus(); }, []);

  const localVenues = searchResults.data ?? [];
  const places = placesResults.data ?? [];
  const localIds = new Set(localVenues.map((v) => v.googlePlaceId).filter(Boolean));
  const filteredPlaces = places.filter((p) => !localIds.has(p.placeId));
  const isPending = followMutation.isPending || createAndFollow.isPending;
  const mono = "var(--font-geist-mono)";

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--surface)", border: "1px solid var(--rule-strong)",
        width: 420, maxHeight: "70vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--rule)" }}>
          <span style={{ fontFamily: mono, fontSize: 12, color: "var(--ink)", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 500 }}>Follow a venue</span>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button>
        </div>
        <div style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--rule)" }}>
          <Search size={13} color="var(--muted)" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search venues..."
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--ink)", fontFamily: "var(--font-geist-sans)", fontSize: 14 }} />
        </div>
        <div style={{ overflow: "auto", maxHeight: 300 }}>
          {query.length < 2 && <div style={{ padding: "20px", color: "var(--faint)", fontFamily: mono, fontSize: 11, textAlign: "center" }}>Type at least 2 characters</div>}
          {(searchResults.isLoading || placesResults.isLoading) && <div style={{ padding: "20px", color: "var(--muted)", fontFamily: mono, fontSize: 11, textAlign: "center" }}>Searching...</div>}
          {placesResults.isError && query.length >= 2 && (
            <div style={{ padding: "10px 20px", color: "#E63946", fontFamily: mono, fontSize: 11 }}>
              Google Places search is unavailable. Showing local matches only.
            </div>
          )}
          {(followMutation.isError || createAndFollow.isError) && (
            <div style={{ padding: "10px 20px", color: "#E63946", fontFamily: mono, fontSize: 11 }}>Failed to follow venue</div>
          )}
          {localVenues.map((v) => (
            <button key={v.id} type="button" disabled={isPending} onClick={() => followMutation.mutate({ venueId: v.id })} style={{
              display: "block", width: "100%", padding: "12px 20px", background: "none", border: "none", borderBottom: "1px solid var(--rule)",
              textAlign: "left", cursor: isPending ? "wait" : "pointer", opacity: isPending ? 0.5 : 1,
            }}>
              <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{v.name}</div>
              <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{v.city}{v.stateRegion ? `, ${v.stateRegion}` : ""}</div>
            </button>
          ))}
          {filteredPlaces.length > 0 && localVenues.length > 0 && (
            <div style={{ padding: "10px 20px", color: "var(--faint)", fontFamily: mono, fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", borderBottom: "1px solid var(--rule)" }}>Google Places</div>
          )}
          {filteredPlaces.map((p) => (
            <button key={p.placeId} type="button" disabled={isPending} onClick={() => createAndFollow.mutate({ placeId: p.placeId })} style={{
              display: "block", width: "100%", padding: "12px 20px", background: "none", border: "none", borderBottom: "1px solid var(--rule)",
              textAlign: "left", cursor: isPending ? "wait" : "pointer", opacity: isPending ? 0.5 : 1,
            }}>
              <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{p.displayName}</div>
              <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{p.formattedAddress}</div>
            </button>
          ))}
          {query.length >= 2 && !searchResults.isLoading && !placesResults.isLoading && localVenues.length === 0 && filteredPlaces.length === 0 && !placesResults.isError && (
            <div style={{ padding: "20px", color: "var(--faint)", fontFamily: mono, fontSize: 11, textAlign: "center" }}>No venues found</div>
          )}
        </div>
      </div>
    </div>
  );
}
