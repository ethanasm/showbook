"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/components/design-system/ThemeProvider";
import { SegmentedControl } from "@/components/design-system/SegmentedControl";

// ── Toggle Switch ──────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        ...toggleStyles.track,
        background: checked ? "var(--marquee-gold)" : "var(--surface-raised)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        style={{
          ...toggleStyles.thumb,
          transform: checked ? "translateX(18px)" : "translateX(2px)",
        }}
      />
    </button>
  );
}

const toggleStyles = {
  track: {
    position: "relative" as const,
    width: 44,
    height: 26,
    borderRadius: 13,
    border: "1px solid var(--border)",
    padding: 0,
    transition: "background 0.2s ease",
    flexShrink: 0,
  },
  thumb: {
    display: "block",
    position: "absolute" as const,
    top: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    background: "#FFFFFF",
    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
    transition: "transform 0.2s ease",
  },
};

// ── Setting Row ────────────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={styles.settingRow}>
      <div style={styles.settingInfo}>
        <span style={styles.settingLabel}>{label}</span>
        {description && (
          <span style={styles.settingDescription}>{description}</span>
        )}
      </div>
      <div style={styles.settingControl}>{children}</div>
    </div>
  );
}

// ── Add Region Form ────────────────────────────────────────

function AddRegionForm({ onAdd }: { onAdd: () => void }) {
  const [cityName, setCityName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("25");

  const addRegion = trpc.preferences.addRegion.useMutation({
    onSuccess: () => {
      setCityName("");
      setLatitude("");
      setLongitude("");
      setRadius("25");
      onAdd();
    },
  });

  const canSubmit =
    cityName.trim() !== "" &&
    latitude !== "" &&
    longitude !== "" &&
    radius !== "" &&
    !addRegion.isPending;

  return (
    <div style={styles.addRegionForm}>
      <div style={styles.addRegionGrid}>
        <div style={styles.inputGroup}>
          <label style={styles.inputLabel}>City</label>
          <input
            type="text"
            value={cityName}
            onChange={(e) => setCityName(e.target.value)}
            placeholder="e.g. Nashville"
            style={styles.input}
          />
        </div>
        <div style={styles.inputGroup}>
          <label style={styles.inputLabel}>Latitude</label>
          <input
            type="number"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            placeholder="36.1627"
            step="any"
            style={styles.input}
          />
        </div>
        <div style={styles.inputGroup}>
          <label style={styles.inputLabel}>Longitude</label>
          <input
            type="number"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            placeholder="-86.7816"
            step="any"
            style={styles.input}
          />
        </div>
        <div style={styles.inputGroup}>
          <label style={styles.inputLabel}>Radius (miles)</label>
          <input
            type="number"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            min="1"
            max="200"
            style={styles.input}
          />
        </div>
      </div>
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
          ...styles.addButton,
          opacity: canSubmit ? 1 : 0.4,
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        {addRegion.isPending ? "Adding..." : "Add Region"}
      </button>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────

const THEME_OPTIONS = ["System", "Light", "Dark"];
const DIGEST_OPTIONS = ["Daily", "Weekly", "Off"];

function themeToDisplay(theme: string): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

function displayToTheme(display: string): "system" | "light" | "dark" {
  return display.toLowerCase() as "system" | "light" | "dark";
}

function digestToDisplay(freq: string): string {
  return freq.charAt(0).toUpperCase() + freq.slice(1);
}

function displayToDigest(display: string): string {
  return display.toLowerCase();
}

export default function PreferencesPage() {
  const { theme: currentTheme, setTheme } = useTheme();

  const prefsQuery = trpc.preferences.get.useQuery();
  const venuesQuery = trpc.venues.followed.useQuery();

  const updatePrefs = trpc.preferences.update.useMutation({
    onSuccess: () => prefsQuery.refetch(),
  });
  const toggleRegion = trpc.preferences.toggleRegion.useMutation({
    onSuccess: () => prefsQuery.refetch(),
  });
  const removeRegion = trpc.preferences.removeRegion.useMutation({
    onSuccess: () => prefsQuery.refetch(),
  });
  const unfollowVenue = trpc.venues.unfollow.useMutation({
    onSuccess: () => venuesQuery.refetch(),
  });

  if (prefsQuery.isLoading || venuesQuery.isLoading) {
    return (
      <div style={styles.container}>
        <p style={styles.loading}>Loading...</p>
      </div>
    );
  }

  const prefs = prefsQuery.data?.preferences;
  const regions = prefsQuery.data?.regions ?? [];
  const venues = venuesQuery.data ?? [];

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Preferences</h1>

      {/* ── Appearance ───────────────────────────────── */}
      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Appearance</h2>

        <SettingRow label="Theme">
          <SegmentedControl
            options={THEME_OPTIONS}
            selected={themeToDisplay(currentTheme)}
            onChange={(value) => {
              const t = displayToTheme(value);
              setTheme(t);
              updatePrefs.mutate({ theme: t });
            }}
          />
        </SettingRow>

        <SettingRow
          label="Compact mode"
          description="Use smaller spacing in show lists"
        >
          <Toggle
            checked={prefs?.compactMode ?? false}
            onChange={(value) => updatePrefs.mutate({ compactMode: value })}
            disabled={updatePrefs.isPending}
          />
        </SettingRow>
      </section>

      {/* ── Notifications ────────────────────────────── */}
      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Notifications</h2>

        <SettingRow label="Email notifications">
          <Toggle
            checked={prefs?.emailNotifications ?? false}
            onChange={(value) =>
              updatePrefs.mutate({ emailNotifications: value })
            }
            disabled={updatePrefs.isPending}
          />
        </SettingRow>

        <SettingRow label="Push notifications">
          <Toggle
            checked={prefs?.pushNotifications ?? false}
            onChange={(value) =>
              updatePrefs.mutate({ pushNotifications: value })
            }
            disabled={updatePrefs.isPending}
          />
        </SettingRow>

        <SettingRow
          label="Show-day reminder"
          description="Get notified on the day of a show"
        >
          <Toggle
            checked={prefs?.showDayReminder ?? false}
            onChange={(value) => updatePrefs.mutate({ showDayReminder: value })}
            disabled={updatePrefs.isPending}
          />
        </SettingRow>

        <SettingRow label="Digest frequency">
          <SegmentedControl
            options={DIGEST_OPTIONS}
            selected={digestToDisplay(prefs?.digestFrequency ?? "off")}
            onChange={(value) =>
              updatePrefs.mutate({
                digestFrequency: displayToDigest(value) as
                  | "daily"
                  | "weekly"
                  | "off",
              })
            }
          />
        </SettingRow>

        <SettingRow label="Digest time">
          <input
            type="time"
            value={prefs?.digestTime ?? "09:00"}
            onChange={(e) =>
              updatePrefs.mutate({ digestTime: e.target.value })
            }
            style={styles.timeInput}
          />
        </SettingRow>
      </section>

      {/* ── Regions ──────────────────────────────────── */}
      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Regions</h2>

        {regions.length > 0 ? (
          <div style={styles.listContainer}>
            {regions.map((region) => (
              <div key={region.id} style={styles.listItem}>
                <div style={styles.listItemInfo}>
                  <span style={styles.listItemName}>{region.cityName}</span>
                  <span style={styles.listItemMeta}>
                    {region.radiusMiles} miles
                  </span>
                </div>
                <div style={styles.listItemActions}>
                  <Toggle
                    checked={region.active}
                    onChange={() =>
                      toggleRegion.mutate({ regionId: region.id })
                    }
                    disabled={toggleRegion.isPending}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      removeRegion.mutate({ regionId: region.id })
                    }
                    disabled={removeRegion.isPending}
                    style={styles.removeButton}
                    aria-label={`Remove ${region.cityName}`}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={styles.emptyText}>No regions configured</p>
        )}

        <div style={styles.formDivider} />
        <h3 style={styles.subSectionTitle}>Add Region</h3>
        <AddRegionForm onAdd={() => prefsQuery.refetch()} />
      </section>

      {/* ── Followed Venues ──────────────────────────── */}
      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Followed Venues</h2>

        {venues.length > 0 ? (
          <div style={styles.listContainer}>
            {venues.map((venue: { id: string; name: string; city?: string }) => (
              <div key={venue.id} style={styles.listItem}>
                <div style={styles.listItemInfo}>
                  <span style={styles.listItemName}>{venue.name}</span>
                  {venue.city && (
                    <span style={styles.listItemMeta}>{venue.city}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => unfollowVenue.mutate({ venueId: venue.id })}
                  disabled={unfollowVenue.isPending}
                  style={styles.unfollowButton}
                >
                  {unfollowVenue.isPending ? "..." : "Unfollow"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p style={styles.emptyText}>
            You&apos;re not following any venues yet
          </p>
        )}
      </section>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 700,
    margin: "0 auto",
    padding: "24px 16px 64px",
  },
  pageTitle: {
    fontFamily: "var(--font-geist-sans)",
    fontWeight: 800,
    fontSize: "1.5rem",
    color: "var(--text-primary)",
    letterSpacing: "-0.02em",
    marginBottom: 24,
  },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 20,
  },
  sectionTitle: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 16,
  },
  settingRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "12px 0",
    borderBottom: "1px solid var(--border)",
  },
  settingInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  settingLabel: {
    fontFamily: "var(--font-geist-sans)",
    fontSize: "0.9rem",
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  settingDescription: {
    fontFamily: "var(--font-geist-sans)",
    fontSize: "0.78rem",
    color: "var(--text-secondary)",
  },
  settingControl: {
    flexShrink: 0,
  },
  listContainer: {
    display: "flex",
    flexDirection: "column",
  },
  listItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 0",
    borderBottom: "1px solid var(--border)",
  },
  listItemInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  listItemName: {
    fontFamily: "var(--font-geist-sans)",
    fontSize: "0.9rem",
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  listItemMeta: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
  },
  listItemActions: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  },
  removeButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  unfollowButton: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.75rem",
    fontWeight: 500,
    color: "var(--text-secondary)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    flexShrink: 0,
  },
  formDivider: {
    height: 1,
    background: "var(--border)",
    margin: "16px 0",
  },
  subSectionTitle: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 12,
  },
  addRegionForm: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  addRegionGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  inputLabel: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.7rem",
    fontWeight: 500,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  input: {
    fontFamily: "var(--font-geist-sans)",
    fontSize: "0.85rem",
    color: "var(--text-primary)",
    background: "var(--surface-raised)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 12px",
    outline: "none",
    width: "100%",
  },
  timeInput: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.85rem",
    color: "var(--text-primary)",
    background: "var(--surface-raised)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "6px 12px",
    outline: "none",
    colorScheme: "dark",
  },
  addButton: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "#0C0C0C",
    background: "var(--marquee-gold)",
    border: "none",
    borderRadius: 8,
    padding: "10px 20px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    alignSelf: "flex-start",
    transition: "opacity 0.15s ease",
  },
  loading: {
    color: "var(--text-secondary)",
    fontFamily: "var(--font-geist-sans)",
    textAlign: "center",
    padding: "48px 0",
  },
  emptyText: {
    color: "var(--text-secondary)",
    fontFamily: "var(--font-geist-sans)",
    fontSize: "0.85rem",
    padding: "8px 0",
  },
};
