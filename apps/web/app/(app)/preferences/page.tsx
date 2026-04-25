"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { MapPin, Check, Plus, Search, X } from "lucide-react";
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
        background: checked ? "var(--accent)" : "rgba(128,128,128,.3)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        style={{
          ...toggleStyles.thumb,
          transform: checked ? "translateX(16px)" : "translateX(0px)",
          background: checked ? "var(--accent-text)" : "rgba(255,255,255,.7)",
        }}
      />
    </button>
  );
}

const toggleStyles = {
  track: {
    position: "relative" as const,
    width: 36,
    height: 20,
    borderRadius: 10,
    border: "none",
    padding: 2,
    transition: "background 0.15s ease",
    flexShrink: 0,
    display: "flex",
    alignItems: "center" as const,
  },
  thumb: {
    display: "block",
    width: 16,
    height: 16,
    borderRadius: 8,
    transition: "all 0.15s ease",
  },
};

// ── Section Header ────────────────────────────────────────

function SectionHead({
  label,
  sub,
}: {
  label: string;
  sub?: string;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontFamily: "var(--font-geist-mono)",
          fontSize: 11,
          color: "var(--ink)",
          letterSpacing: ".1em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: 10.5,
            color: "var(--faint)",
            marginTop: 3,
            letterSpacing: ".04em",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Setting Row ────────────────────────────────────────────

function SettingRow({
  label,
  description,
  last,
  children,
}: {
  label: string;
  description?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 0",
        borderBottom: last ? "none" : "1px solid var(--rule)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-geist-sans)",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ink)",
            letterSpacing: -0.15,
          }}
        >
          {label}
        </div>
        {description && (
          <div
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 10.5,
              color: "var(--muted)",
              marginTop: 3,
              letterSpacing: ".04em",
            }}
          >
            {description}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// ── Region Chip ───────────────────────────────────────────

function RegionChip({
  name,
  radius,
  active,
  onToggle,
  onRemove,
  disabled,
}: {
  name: string;
  radius: number;
  active: boolean;
  onToggle: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        padding: "10px 14px",
        border: active
          ? "1.5px solid var(--accent)"
          : "1px solid var(--rule-strong)",
        background: active ? "var(--accent-faded)" : "transparent",
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      onClick={() => !disabled && onToggle()}
    >
      <MapPin
        size={14}
        color={active ? "var(--accent)" : "var(--faint)"}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-geist-sans)",
            fontSize: 13,
            fontWeight: active ? 600 : 500,
            color: "var(--ink)",
            letterSpacing: -0.1,
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: 10,
            color: "var(--faint)",
            marginTop: 2,
          }}
        >
          {radius}mi radius
        </div>
      </div>
      {active && <Check size={14} color="var(--accent)" />}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onRemove();
        }}
        disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          border: "none",
          background: "transparent",
          color: "var(--faint)",
          cursor: disabled ? "not-allowed" : "pointer",
          padding: 0,
        }}
        aria-label={`Remove ${name}`}
      >
        <svg
          width="12"
          height="12"
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
  );
}

// ── Add Region Form ────────────────────────────────────────

function AddRegionForm({ onAdd }: { onAdd: () => void }) {
  const [cityName, setCityName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("25");
  const [expanded, setExpanded] = useState(false);

  const addRegion = trpc.preferences.addRegion.useMutation({
    onSuccess: () => {
      setCityName("");
      setLatitude("");
      setLongitude("");
      setRadius("25");
      setExpanded(false);
      onAdd();
    },
  });

  const canSubmit =
    cityName.trim() !== "" &&
    latitude !== "" &&
    longitude !== "" &&
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={formStyles.inputLabel}>City</label>
          <input
            type="text"
            value={cityName}
            onChange={(e) => setCityName(e.target.value)}
            placeholder="e.g. Nashville"
            style={formStyles.input}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={formStyles.inputLabel}>Latitude</label>
          <input
            type="number"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            placeholder="36.1627"
            step="any"
            style={formStyles.input}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={formStyles.inputLabel}>Longitude</label>
          <input
            type="number"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            placeholder="-86.7816"
            step="any"
            style={formStyles.input}
          />
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
          onClick={() => setExpanded(false)}
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
};

// ── Data Source Row ────────────────────────────────────────

const DATA_SOURCES = [
  { name: "setlist.fm", desc: "Setlists, tour info, song data", connected: true },
  { name: "Ticketmaster", desc: "Venue, date, seat, pricing", connected: true },
  { name: "Playbill", desc: "Theatre cast on the night", connected: true },
  { name: "Wikipedia", desc: "Material context, album info", connected: false },
] as const;

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

function VenueFollowModal({ onClose, onFollowed }: { onClose: () => void; onFollowed: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const searchResults = trpc.venues.search.useQuery({ query }, { enabled: query.length >= 2 });
  const followMutation = trpc.venues.follow.useMutation({
    onSuccess: () => { setQuery(""); onFollowed(); },
  });

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = searchResults.data ?? [];

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
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 12, color: "var(--ink)", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 500 }}>Follow a venue</span>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button>
        </div>
        <div style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--rule)" }}>
          <Search size={13} color="var(--muted)" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search venues..."
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--ink)", fontFamily: "var(--font-geist-sans)", fontSize: 14 }} />
        </div>
        <div style={{ overflow: "auto", maxHeight: 300 }}>
          {query.length < 2 && <div style={{ padding: "20px", color: "var(--faint)", fontFamily: "var(--font-geist-mono)", fontSize: 11, textAlign: "center" }}>Type at least 2 characters</div>}
          {searchResults.isLoading && <div style={{ padding: "20px", color: "var(--muted)", fontFamily: "var(--font-geist-mono)", fontSize: 11, textAlign: "center" }}>Searching...</div>}
          {followMutation.isError && (
            <div style={{ padding: "10px 20px", color: "#E63946", fontFamily: "var(--font-geist-mono)", fontSize: 11 }}>Failed to follow venue</div>
          )}
          {results.map((v) => (
            <button key={v.id} type="button" disabled={followMutation.isPending} onClick={() => followMutation.mutate({ venueId: v.id })} style={{
              display: "block", width: "100%", padding: "12px 20px", background: "none", border: "none", borderBottom: "1px solid var(--rule)",
              textAlign: "left", cursor: followMutation.isPending ? "wait" : "pointer", opacity: followMutation.isPending ? 0.5 : 1,
            }}>
              <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{v.name}</div>
              <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{v.city}{v.stateRegion ? `, ${v.stateRegion}` : ""}</div>
            </button>
          ))}
          {query.length >= 2 && !searchResults.isLoading && results.length === 0 && (
            <div style={{ padding: "20px", color: "var(--faint)", fontFamily: "var(--font-geist-mono)", fontSize: 11, textAlign: "center" }}>No venues found</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PreferencesPage() {
  const { theme: currentTheme, setTheme } = useTheme();
  const { data: session } = useSession();

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
  const [showFollowModal, setShowFollowModal] = useState(false);

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
  const userEmail = session?.user?.email ?? "";

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLabel}>Settings</div>
        <h1 style={styles.pageTitle}>Preferences</h1>
      </div>

      <div style={styles.content}>
        <div style={styles.contentInner}>

          {/* ── Account ─────────────────────────────── */}
          <SectionHead label="Account" sub="your login" />
          <div style={styles.card}>
            <SettingRow label="Email" description="for digests and account recovery" last>
              <span style={styles.emailDisplay}>{userEmail}</span>
            </SettingRow>
          </div>

          {/* ── Appearance ───────────────────────────── */}
          <SectionHead label="Appearance" sub="theme and display" />
          <div style={styles.card}>
            <SettingRow label="Theme" description="applies to all pages">
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
              description="denser rows in list views"
              last
            >
              <Toggle
                checked={prefs?.compactMode ?? false}
                onChange={(value) => updatePrefs.mutate({ compactMode: value })}
                disabled={updatePrefs.isPending}
              />
            </SettingRow>
          </div>

          {/* ── Notifications ────────────────────────── */}
          <SectionHead label="Notifications" sub="how and when we reach you" />
          <div style={styles.card}>
            <SettingRow
              label="Discover digest"
              description="summary of new announcements from followed venues"
            >
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

            <SettingRow label="Digest time" description="when to send the email">
              <input
                type="time"
                value={prefs?.digestTime ?? "09:00"}
                onChange={(e) =>
                  updatePrefs.mutate({ digestTime: e.target.value })
                }
                style={styles.timeInput}
              />
            </SettingRow>

            <SettingRow
              label="Email notifications"
              description="new shows, on-sale alerts, venue updates"
            >
              <Toggle
                checked={prefs?.emailNotifications ?? false}
                onChange={(value) =>
                  updatePrefs.mutate({ emailNotifications: value })
                }
                disabled={updatePrefs.isPending}
              />
            </SettingRow>

            <SettingRow
              label="Push notifications"
              description="mobile app alerts"
            >
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
              description="morning of the show - doors, seat, venue"
              last
            >
              <Toggle
                checked={prefs?.showDayReminder ?? false}
                onChange={(value) =>
                  updatePrefs.mutate({ showDayReminder: value })
                }
                disabled={updatePrefs.isPending}
              />
            </SettingRow>
          </div>

          {/* ── Regions ──────────────────────────────── */}
          <SectionHead label="Regions" sub="where to look for nearby shows" />
          <div style={{ ...styles.card, padding: "16px 20px" }}>
            {regions.length > 0 ? (
              <>
                <div style={styles.regionGrid}>
                  {regions.map((region) => (
                    <RegionChip
                      key={region.id}
                      name={region.cityName}
                      radius={region.radiusMiles}
                      active={region.active}
                      onToggle={() =>
                        toggleRegion.mutate({ regionId: region.id })
                      }
                      onRemove={() =>
                        removeRegion.mutate({ regionId: region.id })
                      }
                      disabled={
                        toggleRegion.isPending || removeRegion.isPending
                      }
                    />
                  ))}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 12,
                  }}
                >
                  <AddRegionForm onAdd={() => prefsQuery.refetch()} />
                  <div
                    style={{
                      fontFamily: "var(--font-geist-mono)",
                      fontSize: 10.5,
                      color: "var(--faint)",
                      letterSpacing: ".04em",
                    }}
                  >
                    active regions appear in Discover
                  </div>
                </div>
              </>
            ) : (
              <>
                <p style={styles.emptyText}>No regions configured</p>
                <AddRegionForm onAdd={() => prefsQuery.refetch()} />
              </>
            )}
          </div>

          {/* ── Followed Venues ──────────────────────── */}
          <SectionHead
            label="Followed venues"
            sub="announcements from these venues appear in Discover"
          />
          <div style={styles.card}>
            {venues.length > 0 ? (
              <>
                {venues.map(
                  (
                    venue: { id: string; name: string; city?: string },
                    i: number
                  ) => (
                    <div
                      key={venue.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 0",
                        borderBottom:
                          i < venues.length - 1
                            ? "1px solid var(--rule)"
                            : "none",
                      }}
                    >
                      <MapPin size={14} color="var(--faint)" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "var(--font-geist-sans)",
                            fontSize: 13.5,
                            fontWeight: 500,
                            color: "var(--ink)",
                            letterSpacing: -0.15,
                          }}
                        >
                          {venue.name}
                        </div>
                        {venue.city && (
                          <div
                            style={{
                              fontFamily: "var(--font-geist-mono)",
                              fontSize: 10,
                              color: "var(--faint)",
                              marginTop: 2,
                            }}
                          >
                            {venue.city.toLowerCase()}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          unfollowVenue.mutate({ venueId: venue.id })
                        }
                        disabled={unfollowVenue.isPending}
                        style={styles.unfollowButton}
                      >
                        {unfollowVenue.isPending ? "..." : "Unfollow"}
                      </button>
                    </div>
                  )
                )}
              </>
            ) : (
              <p style={styles.emptyText}>
                You&apos;re not following any venues yet
              </p>
            )}
            <div
              onClick={() => setShowFollowModal(true)}
              style={{
                padding: "12px 0",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--font-geist-mono)",
                fontSize: 10.5,
                color: "var(--accent)",
                letterSpacing: ".04em",
                cursor: "pointer",
              }}
            >
              <Plus size={11} color="var(--accent)" /> Follow a venue
            </div>
          </div>

          {showFollowModal && (
            <VenueFollowModal
              onClose={() => setShowFollowModal(false)}
              onFollowed={() => { venuesQuery.refetch(); setShowFollowModal(false); }}
            />
          )}

          {/* ── Data Sources ─────────────────────────── */}
          <SectionHead label="Data sources" sub="auto-enrichment for show details" />
          <div style={styles.card}>
            {DATA_SOURCES.map((source, i) => (
              <SettingRow
                key={source.name}
                label={source.name}
                description={source.desc}
                last={i === DATA_SOURCES.length - 1}
              >
                {source.connected ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Check size={12} color="var(--accent)" />
                    <span
                      style={{
                        fontFamily: "var(--font-geist-mono)",
                        fontSize: 10.5,
                        color: "var(--accent)",
                        fontWeight: 500,
                      }}
                    >
                      Connected
                    </span>
                  </div>
                ) : (
                  <span
                    style={{
                      fontFamily: "var(--font-geist-mono)",
                      fontSize: 10.5,
                      color: "var(--faint)",
                    }}
                  >
                    Disconnected
                  </span>
                )}
              </SettingRow>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  header: {
    padding: "16px 36px",
    borderBottom: "1px solid var(--rule)",
  },
  headerLabel: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 10.5,
    color: "var(--muted)",
    letterSpacing: ".1em",
    textTransform: "uppercase",
  },
  pageTitle: {
    fontFamily: "var(--font-geist-sans)",
    fontWeight: 600,
    fontSize: 26,
    color: "var(--ink)",
    letterSpacing: -0.9,
    marginTop: 4,
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: "28px 36px 60px",
  },
  contentInner: {
    maxWidth: 720,
  },
  card: {
    background: "var(--surface)",
    padding: "4px 20px 4px",
    marginBottom: 36,
  },
  loading: {
    color: "var(--muted)",
    fontFamily: "var(--font-geist-sans)",
    textAlign: "center",
    padding: "48px 0",
  },
  emptyText: {
    color: "var(--faint)",
    fontFamily: "var(--font-geist-sans)",
    fontSize: "0.85rem",
    padding: "8px 0",
  },
  emailDisplay: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 12,
    color: "var(--muted)",
  },
  regionGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 10,
  },
  unfollowButton: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 10,
    fontWeight: 500,
    color: "var(--muted)",
    background: "transparent",
    border: "1px solid var(--rule-strong)",
    borderRadius: 0,
    padding: "5px 10px",
    cursor: "pointer",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    transition: "all 0.15s ease",
    flexShrink: 0,
  },
  timeInput: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 13,
    color: "var(--accent)",
    background: "transparent",
    border: "none",
    padding: "4px 0",
    outline: "none",
    fontWeight: 500,
  },
};
