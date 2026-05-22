"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePlaceSearch } from "@/lib/usePlaceSearch";

interface AddRegionFormProps {
  onAdd: () => void;
}

export function AddRegionForm({ onAdd }: AddRegionFormProps) {
  const [cityQuery, setCityQuery] = useState("");
  const [cityName, setCityName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("25");
  const [expanded, setExpanded] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const citySearch = usePlaceSearch(cityQuery, {
    types: "city",
    // Pause the query once a place is selected so the resolved
    // city name doesn't trigger a redundant searchPlaces request.
    enabled: !manualMode && cityName === "",
  });

  const addRegion = trpc.preferences.addRegion.useMutation({
    onSuccess: () => {
      setCityQuery("");
      setCityName("");
      setLatitude("");
      setLongitude("");
      setRadius("25");
      setExpanded(false);
      setManualMode(false);
      setDetailsError(null);
      onAdd();
    },
  });

  const handleCityInput = (value: string) => {
    setCityQuery(value);
    if (!manualMode) {
      setCityName("");
      setLatitude("");
      setLongitude("");
    } else {
      setCityName(value);
    }
    setDetailsError(null);
  };

  const handleSelectCity = async (placeId: string) => {
    try {
      const details = await citySearch.fetchPlaceDetails(placeId);
      if (details) {
        setCityName(details.city || details.name);
        setCityQuery(details.city || details.name);
        setLatitude(String(details.latitude));
        setLongitude(String(details.longitude));
        setDetailsError(null);
      }
    } catch {
      setDetailsError(
        "Couldn't load location details. Try again, or enter coordinates manually below.",
      );
    }
  };

  const searchFailed = !manualMode && citySearch.isSearchError;

  const canSubmit =
    cityName.trim() !== "" &&
    latitude !== "" &&
    longitude !== "" &&
    !Number.isNaN(parseFloat(latitude)) &&
    !Number.isNaN(parseFloat(longitude)) &&
    radius !== "" &&
    !addRegion.isPending;

  if (!expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "var(--font-geist-mono)",
          fontSize: 10.5,
          color: "var(--accent)",
          letterSpacing: ".04em",
          cursor: "pointer",
          marginTop: 12,
        }}
      >
        <Plus size={11} color="var(--accent)" /> Add a region
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative" }}>
          <label style={formStyles.inputLabel}>City</label>
          <input
            type="text"
            value={cityQuery}
            onChange={(e) => handleCityInput(e.target.value)}
            placeholder="e.g. Nashville"
            style={formStyles.input}
          />
          {!manualMode &&
            cityName === "" &&
            citySearch.debouncedQuery.length >= 2 &&
            citySearch.debouncedQuery === cityQuery && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
              background: "var(--surface)", border: "1px solid var(--rule-strong)",
              maxHeight: 200, overflow: "auto",
            }}>
              {citySearch.isSearching && (
                <div style={{ padding: "8px 12px", fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: "var(--muted)" }}>Searching...</div>
              )}
              {citySearch.isSearchError && (
                <div style={{ padding: "8px 12px", fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: "#E63946" }}>
                  Search unavailable. Use manual entry below.
                </div>
              )}
              {citySearch.results.length === 0 && !citySearch.isSearching && (
                <div style={{ padding: "8px 12px", fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: "var(--faint)" }}>No matches</div>
              )}
              {citySearch.results.map((p) => (
                <button key={p.placeId} type="button" onClick={() => handleSelectCity(p.placeId)} style={{
                  display: "block", width: "100%", padding: "8px 12px", background: "none", border: "none",
                  borderBottom: "1px solid var(--rule)", textAlign: "left", cursor: "pointer",
                }}>
                  <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: 13, color: "var(--ink)" }}>{p.displayName}</div>
                  <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "var(--muted)" }}>{p.formattedAddress}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={formStyles.inputLabel}>Radius (miles)</label>
          <input
            type="number"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            min="1"
            max="200"
            style={formStyles.input}
          />
        </div>
      </div>

      {detailsError && (
        <div style={formStyles.errorMessage}>{detailsError}</div>
      )}
      {searchFailed && !manualMode && (
        <div style={formStyles.errorMessage}>
          City search is unavailable right now.
        </div>
      )}

      {manualMode && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={formStyles.inputLabel}>Latitude</label>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="36.1627"
              style={formStyles.input}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={formStyles.inputLabel}>Longitude</label>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="-86.7816"
              style={formStyles.input}
            />
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <button
          type="button"
          onClick={() => {
            setManualMode((prev) => {
              const next = !prev;
              if (next) {
                setCityName(cityQuery);
              }
              return next;
            });
          }}
          style={formStyles.linkButton}
        >
          {manualMode ? "Use city search instead" : "Enter coordinates manually"}
        </button>
      </div>

      {addRegion.isError && (
        <div style={formStyles.errorMessage}>
          Couldn&apos;t add region: {addRegion.error?.message ?? "unknown error"}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() =>
            addRegion.mutate({
              cityName: cityName.trim(),
              latitude: parseFloat(latitude),
              longitude: parseFloat(longitude),
              radiusMiles: parseInt(radius, 10),
            })
          }
          style={{
            ...formStyles.addButton,
            opacity: canSubmit ? 1 : 0.4,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {addRegion.isPending ? "Adding..." : "Add Region"}
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setManualMode(false);
            setDetailsError(null);
          }}
          style={formStyles.cancelButton}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const formStyles: Record<string, React.CSSProperties> = {
  inputLabel: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.7rem",
    fontWeight: 500,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  input: {
    fontFamily: "var(--font-geist-sans)",
    fontSize: "0.85rem",
    color: "var(--ink)",
    background: "var(--surface2)",
    border: "1px solid var(--rule)",
    borderRadius: 0,
    padding: "8px 12px",
    outline: "none",
    width: "100%",
  },
  addButton: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--accent-text)",
    background: "var(--accent)",
    border: "none",
    borderRadius: 0,
    padding: "8px 16px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    transition: "opacity 0.15s ease",
  },
  cancelButton: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.75rem",
    fontWeight: 500,
    color: "var(--muted)",
    background: "transparent",
    border: "1px solid var(--rule-strong)",
    borderRadius: 0,
    padding: "8px 16px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    cursor: "pointer",
    transition: "opacity 0.15s ease",
  },
  errorMessage: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.7rem",
    color: "#E63946",
    marginTop: 8,
    letterSpacing: "0.04em",
  },
  linkButton: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.7rem",
    fontWeight: 500,
    color: "var(--accent)",
    background: "transparent",
    border: "none",
    padding: "6px 0 0",
    cursor: "pointer",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
};
