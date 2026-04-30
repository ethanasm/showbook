"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface RegionSearchModalProps {
  onClose: () => void;
  onAdded: (regionId: string) => void;
}

export function RegionSearchModal({
  onClose,
  onAdded,
}: RegionSearchModalProps) {
  const [cityQuery, setCityQuery] = useState("");
  const [cityName, setCityName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("25");
  const [manualMode, setManualMode] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [debouncedCity, setDebouncedCity] = useState("");
  const cityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const citySearch = trpc.enrichment.searchPlaces.useQuery(
    { query: debouncedCity, types: "city" },
    { enabled: debouncedCity.length >= 2 && !manualMode, retry: false },
  );

  const addRegion = trpc.preferences.addRegion.useMutation({
    onSuccess: (region) => {
      onAdded(region.id);
      onClose();
    },
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    if (cityTimerRef.current) clearTimeout(cityTimerRef.current);
    if (value.length >= 2 && !manualMode) {
      cityTimerRef.current = setTimeout(() => setDebouncedCity(value), 400);
    } else {
      setDebouncedCity("");
    }
  };

  const handleSelectCity = async (placeId: string) => {
    try {
      const details = await utils.enrichment.placeDetails.fetch({ placeId });
      if (details) {
        setCityName(details.city || details.name);
        setCityQuery(details.city || details.name);
        setLatitude(String(details.latitude));
        setLongitude(String(details.longitude));
        setDebouncedCity("");
        setDetailsError(null);
      }
    } catch {
      setDetailsError(
        "Couldn't load location details. Try again, or enter coordinates manually below.",
      );
    }
  };

  const canSubmit =
    cityName.trim() !== "" &&
    latitude !== "" &&
    longitude !== "" &&
    !Number.isNaN(parseFloat(latitude)) &&
    !Number.isNaN(parseFloat(longitude)) &&
    radius !== "" &&
    !addRegion.isPending;

  return (
    <div className="discover-modal-overlay" onClick={onClose}>
      <div
        className="discover-modal discover-modal--region"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="discover-modal__header">
          <div className="discover-modal__title">Follow a region</div>
          <button
            type="button"
            className="discover-modal__close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        <div className="discover-region-form">
          <div className="discover-region-form__row">
            <label className="discover-region-form__field">
              <span className="discover-region-form__label">City</span>
              <div className="discover-modal__search discover-region-form__search">
                <Search size={13} color="var(--muted)" />
                <input
                  ref={inputRef}
                  value={cityQuery}
                  onChange={(e) => handleCityInput(e.target.value)}
                  placeholder="e.g. Nashville"
                  className="discover-modal__input"
                />
              </div>
            </label>
            <label className="discover-region-form__field discover-region-form__field--radius">
              <span className="discover-region-form__label">Radius</span>
              <input
                type="number"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                min="1"
                max="200"
                className="discover-region-form__input"
              />
            </label>
          </div>

          {!manualMode && debouncedCity.length >= 2 && (
            <div className="discover-region-form__places">
              {citySearch.isLoading && (
                <div className="discover-modal__hint">Searching...</div>
              )}
              {citySearch.isError && (
                <div className="discover-region-form__error">
                  Search unavailable. Use manual entry below.
                </div>
              )}
              {citySearch.data?.length === 0 && !citySearch.isLoading && (
                <div className="discover-modal__hint">No matches</div>
              )}
              {citySearch.data?.map((place) => (
                <button
                  key={place.placeId}
                  type="button"
                  className="discover-modal__result"
                  onClick={() => handleSelectCity(place.placeId)}
                >
                  <div className="discover-modal__result-body">
                    <div className="discover-modal__result-name">
                      {place.displayName}
                    </div>
                    <div className="discover-modal__result-meta">
                      {place.formattedAddress}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {(detailsError || addRegion.isError) && (
            <div className="discover-region-form__error">
              {detailsError ??
                `Couldn't add region: ${addRegion.error?.message ?? "unknown error"}`}
            </div>
          )}

          {manualMode && (
            <div className="discover-region-form__row">
              <label className="discover-region-form__field">
                <span className="discover-region-form__label">Latitude</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  placeholder="36.1627"
                  className="discover-region-form__input"
                />
              </label>
              <label className="discover-region-form__field">
                <span className="discover-region-form__label">Longitude</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  placeholder="-86.7816"
                  className="discover-region-form__input"
                />
              </label>
            </div>
          )}

          <button
            type="button"
            className="discover-region-form__manual"
            onClick={() => {
              setManualMode((prev) => {
                const next = !prev;
                if (next) {
                  setCityName(cityQuery);
                  setDebouncedCity("");
                }
                return next;
              });
            }}
          >
            {manualMode
              ? "Use city search instead"
              : "Enter coordinates manually"}
          </button>

          <div className="discover-region-form__actions">
            <button
              type="button"
              className="discover-region-form__add"
              disabled={!canSubmit}
              onClick={() =>
                addRegion.mutate({
                  cityName: cityName.trim(),
                  latitude: parseFloat(latitude),
                  longitude: parseFloat(longitude),
                  radiusMiles: parseInt(radius, 10),
                })
              }
            >
              {addRegion.isPending ? "Following..." : "Follow Region"}
            </button>
            <button
              type="button"
              className="discover-region-form__cancel"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
