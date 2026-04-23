"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { trpc } from "@/lib/trpc";
import { KindBadge, type ShowKind } from "@/components/design-system/KindBadge";
import "./map.css";

// Fix Leaflet default marker icon in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x.src,
  iconUrl: markerIcon.src,
  shadowUrl: markerShadow.src,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VenueShowData {
  id: string;
  kind: ShowKind;
  state: string;
  date: string;
  headliner: string;
}

interface VenueGroup {
  venueId: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
  shows: VenueShowData[];
  kindBreakdown: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHeadliner(
  showPerformers: {
    role: string;
    sortOrder: number;
    performer: { name: string };
  }[]
): string {
  const headliner = showPerformers.find(
    (sp) => sp.role === "headliner" && sp.sortOrder === 0
  );
  if (headliner) return headliner.performer.name;
  const fallback = showPerformers.find((sp) => sp.role === "headliner");
  if (fallback) return fallback.performer.name;
  return showPerformers[0]?.performer.name ?? "Unknown Artist";
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const KIND_LABELS: Record<string, string> = {
  concert: "concert",
  theatre: "theatre",
  comedy: "comedy",
  festival: "festival",
};

function pluralize(count: number, singular: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${singular}s`;
}

// ---------------------------------------------------------------------------
// FitBounds component - adjusts map to fit all markers
// ---------------------------------------------------------------------------

function FitBounds({ venues }: { venues: VenueGroup[] }) {
  const map = useMap();

  useEffect(() => {
    if (venues.length === 0) return;
    if (venues.length === 1) {
      map.setView([venues[0].latitude, venues[0].longitude], 14);
      return;
    }
    const bounds = L.latLngBounds(
      venues.map((v) => [v.latitude, v.longitude] as [number, number])
    );
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [venues, map]);

  return null;
}

// ---------------------------------------------------------------------------
// Venue Inspector Panel
// ---------------------------------------------------------------------------

function VenueInspector({
  venue,
  onClose,
}: {
  venue: VenueGroup;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: followedVenues } = trpc.venues.followed.useQuery();

  const isFollowed = useMemo(
    () => followedVenues?.some((v) => v.id === venue.venueId) ?? false,
    [followedVenues, venue.venueId]
  );

  const followMutation = trpc.venues.follow.useMutation({
    onSuccess: () => utils.venues.followed.invalidate(),
  });

  const unfollowMutation = trpc.venues.unfollow.useMutation({
    onSuccess: () => utils.venues.followed.invalidate(),
  });

  const handleFollowToggle = useCallback(() => {
    if (isFollowed) {
      unfollowMutation.mutate({ venueId: venue.venueId });
    } else {
      followMutation.mutate({ venueId: venue.venueId });
    }
  }, [isFollowed, venue.venueId, followMutation, unfollowMutation]);

  const kindSummary = Object.entries(venue.kindBreakdown)
    .map(([kind, count]) => pluralize(count, KIND_LABELS[kind] ?? kind))
    .join(", ");

  const isMutating = followMutation.isPending || unfollowMutation.isPending;

  return (
    <div className="venue-inspector">
      <div className="venue-inspector__header">
        <div>
          <h2 className="venue-inspector__name">{venue.name}</h2>
          <p className="venue-inspector__city">{venue.city}</p>
        </div>
        <button
          className="venue-inspector__close"
          onClick={onClose}
          type="button"
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>

      <div className="venue-inspector__stats">
        <span className="venue-inspector__show-count">
          {pluralize(venue.shows.length, "show")}
        </span>
        <span className="venue-inspector__kind-breakdown">{kindSummary}</span>
      </div>

      <button
        className={`venue-inspector__follow-btn ${
          isFollowed ? "venue-inspector__follow-btn--following" : ""
        }`}
        onClick={handleFollowToggle}
        disabled={isMutating}
        type="button"
      >
        {isMutating
          ? "..."
          : isFollowed
            ? "Following"
            : "Follow Venue"}
      </button>

      <div className="venue-inspector__shows">
        {venue.shows.map((show) => (
          <div key={show.id} className="venue-inspector__show-row">
            <div className="venue-inspector__show-info">
              <span className="venue-inspector__show-headliner">
                {show.headliner}
              </span>
              <span className="venue-inspector__show-date">
                {formatDate(show.date)}
              </span>
            </div>
            <KindBadge kind={show.kind} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main MapView
// ---------------------------------------------------------------------------

export default function MapView() {
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);

  const { data: shows, isLoading } = trpc.shows.list.useQuery({});

  const venueGroups = useMemo(() => {
    if (!shows) return [];

    const grouped = new Map<string, VenueGroup>();

    for (const show of shows) {
      const venue = show.venue;
      if (!venue || venue.latitude == null || venue.longitude == null) continue;

      const existing = grouped.get(venue.id);
      const showData: VenueShowData = {
        id: show.id,
        kind: show.kind as ShowKind,
        state: show.state,
        date: show.date,
        headliner: getHeadliner(show.showPerformers),
      };

      if (existing) {
        existing.shows.push(showData);
        existing.kindBreakdown[show.kind] =
          (existing.kindBreakdown[show.kind] ?? 0) + 1;
      } else {
        grouped.set(venue.id, {
          venueId: venue.id,
          name: venue.name,
          city: venue.city,
          latitude: venue.latitude,
          longitude: venue.longitude,
          shows: [showData],
          kindBreakdown: { [show.kind]: 1 },
        });
      }
    }

    return Array.from(grouped.values());
  }, [shows]);

  const selectedVenue = useMemo(
    () => venueGroups.find((v) => v.venueId === selectedVenueId) ?? null,
    [venueGroups, selectedVenueId]
  );

  const defaultCenter: [number, number] = useMemo(() => {
    if (venueGroups.length === 0) return [40.7128, -74.006];
    const avgLat =
      venueGroups.reduce((sum, v) => sum + v.latitude, 0) / venueGroups.length;
    const avgLng =
      venueGroups.reduce((sum, v) => sum + v.longitude, 0) / venueGroups.length;
    return [avgLat, avgLng];
  }, [venueGroups]);

  if (isLoading) {
    return (
      <div className="map-loading">
        <p>Loading your shows...</p>
      </div>
    );
  }

  if (venueGroups.length === 0) {
    return (
      <div className="map-empty">
        <p>No venues with coordinates.</p>
        <p>Add a show with a venue to see it on the map.</p>
      </div>
    );
  }

  return (
    <div className="map-container">
      <MapContainer
        center={defaultCenter}
        zoom={12}
        className="map-leaflet"
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds venues={venueGroups} />
        {venueGroups.map((venue) => (
          <Marker
            key={venue.venueId}
            position={[venue.latitude, venue.longitude]}
            eventHandlers={{
              click: () => setSelectedVenueId(venue.venueId),
            }}
          >
            <Popup>
              <strong>{venue.name}</strong>
              <br />
              {pluralize(venue.shows.length, "show")}
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {selectedVenue && (
        <VenueInspector
          venue={selectedVenue}
          onClose={() => setSelectedVenueId(null)}
        />
      )}
    </div>
  );
}
