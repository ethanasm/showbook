"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { toast } from "sonner";
import { MapPin, Check, Plus, Search, X, LogOut, Music, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/components/design-system/ThemeProvider";
import { SegmentedControl } from "@/components/design-system/SegmentedControl";
import { Toggle } from "@/components/design-system";
import { SectionHead, SettingRow } from "@/components/PreferencesPrimitives";
import { SpotifyImport } from "@/components/preferences/SpotifyImport";
import { AddRegionForm } from "@/components/preferences/AddRegionForm";
import { RegionChip } from "@/components/preferences/RegionChip";
import { VenueFollowModal } from "@/components/preferences/VenueFollowModal";
import { setlistSpoilersConverter, themeConverter } from "@/lib/enum-converters";
import {
  entityLimit,
  canAddEntity,
  entityLimitReachedHint,
} from "@showbook/shared";

// ── Data Source Row ────────────────────────────────────────

// Built-in integrations: enrichment data sources Showbook talks to through
// shared, app-wide keys (or no key, for Wikidata / setlist.fm). They aren't
// tied to your account and need no sign-in — every account uses the same ones.
const DATA_SOURCES = [
  { name: "setlist.fm", desc: "Setlists, tour info, song data", connected: true },
  { name: "Ticketmaster", desc: "Venue, date, seat, pricing", connected: true },
  { name: "Google Places", desc: "City & venue search, map photos", connected: true },
  { name: "Wikidata", desc: "Theatre cast IDs, photos & links", connected: true },
  { name: "Playbill", desc: "Theatre cast on the night", connected: true },
] as const;

function ArtistFollowModal({ onClose, onFollowed }: { onClose: () => void; onFollowed: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();
  const searchResults = trpc.discover.searchArtists.useQuery(
    { keyword: trimmed },
    { enabled: trimmed.length >= 2, retry: false },
  );
  const followMutation = trpc.performers.followAttraction.useMutation({
    onSuccess: () => { setQuery(""); onFollowed(); },
  });

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = searchResults.data ?? [];
  const isPending = followMutation.isPending;
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
          <span style={{ fontFamily: mono, fontSize: 12, color: "var(--ink)", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 500 }}>Follow an artist</span>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><X size={14} /></button>
        </div>
        <div style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--rule)" }}>
          <Search size={13} color="var(--muted)" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search artists..."
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--ink)", fontFamily: "var(--font-geist-sans)", fontSize: 14 }} />
        </div>
        <div style={{ overflow: "auto", maxHeight: 300 }}>
          {trimmed.length < 2 && <div style={{ padding: "20px", color: "var(--faint)", fontFamily: mono, fontSize: 11, textAlign: "center" }}>Type at least 2 characters</div>}
          {searchResults.isLoading && <div style={{ padding: "20px", color: "var(--muted)", fontFamily: mono, fontSize: 11, textAlign: "center" }}>Searching...</div>}
          {followMutation.isError && (
            <div style={{ padding: "10px 20px", color: "#E63946", fontFamily: mono, fontSize: 11 }}>Failed to follow artist</div>
          )}
          {results.map((a) => (
            <button key={a.id} type="button" disabled={isPending}
              onClick={() => followMutation.mutate({ tmAttractionId: a.id, name: a.name, imageUrl: a.imageUrl ?? undefined })}
              style={{
                display: "block", width: "100%", padding: "12px 20px", background: "none", border: "none", borderBottom: "1px solid var(--rule)",
                textAlign: "left", cursor: isPending ? "wait" : "pointer", opacity: isPending ? 0.5 : 1,
              }}>
              <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{a.name}</div>
            </button>
          ))}
          {trimmed.length >= 2 && !searchResults.isLoading && results.length === 0 && (
            <div style={{ padding: "20px", color: "var(--faint)", fontFamily: mono, fontSize: 11, textAlign: "center" }}>No artists found</div>
          )}
        </div>
      </div>
    </div>
  );
}

const VENUES_PER_PAGE = 10;
const ARTISTS_PER_PAGE = 10;

export default function PreferencesView() {
  const { theme: currentTheme, setTheme } = useTheme();
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const [venuePage, setVenuePage] = useState(0);
  const [artistPage, setArtistPage] = useState(0);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const prefsQuery = trpc.preferences.get.useQuery(undefined, {
    staleTime: 60_000,
  });
  const venuesQuery = trpc.venues.followed.useQuery(undefined, {
    staleTime: 60_000,
  });
  const followedArtistsQuery = trpc.performers.followed.useQuery(undefined, {
    staleTime: 60_000,
  });
  // Mirrors AppShell's gating — same tRPC procedure, same staleTime. Used
  // to surface the admin link on mobile, where the desktop sidebar (which
  // already exposes /admin) is hidden.
  const amIAdminQuery = trpc.admin.amIAdmin.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const isAdmin = amIAdminQuery.data?.isAdmin ?? false;

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
    meta: { successToast: "Unfollowed venue" },
    onSuccess: () => {
      venuesQuery.refetch();
      utils.discover.followedFeed.invalidate();
      utils.discover.nearbyFeed.invalidate();
    },
  });
  const unfollowArtist = trpc.performers.unfollow.useMutation({
    meta: { successToast: "Unfollowed artist" },
    onSuccess: () => {
      followedArtistsQuery.refetch();
      utils.discover.followedArtistsFeed.invalidate();
      utils.performers.followed.invalidate();
    },
  });
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [showArtistFollowModal, setShowArtistFollowModal] = useState(false);

  if (prefsQuery.isLoading || venuesQuery.isLoading) {
    return (
      <div style={styles.container}>
        {/* skeleton header */}
        <div style={{ padding: "16px var(--page-pad-x)", borderBottom: "1px solid var(--rule)", height: 52 }} />
        {/* skeleton sections */}
        <div style={{ padding: "28px var(--page-pad-x)", display: "grid", gap: 28, alignContent: "start" }}>
          {Array.from({ length: 3 }).map((_, sectionIdx) => (
            <div key={sectionIdx} style={{ display: "grid", gap: 10 }}>
              <div style={{ height: 14, width: 140, background: "var(--rule)" }} />
              <div style={{ display: "grid", gap: 1, background: "var(--rule)" }}>
                <div style={{ height: 40, background: "var(--surface)" }} />
                <div style={{ height: 40, background: "var(--surface)" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const prefs = prefsQuery.data?.preferences;
  const regions = prefsQuery.data?.regions ?? [];
  const venues = venuesQuery.data ?? [];
  const followedArtists = followedArtistsQuery.data ?? [];
  const userEmail = session?.user?.email ?? "";
  const userName = session?.user?.name ?? "";

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
            {userName && (
              <SettingRow label="Name" description="from your Google account">
                <span style={styles.emailDisplay}>{userName}</span>
              </SettingRow>
            )}
            <SettingRow label="Email" description="for digests and account recovery">
              <span style={styles.emailDisplay}>{userEmail}</span>
            </SettingRow>
            <SettingRow label="Sign out" description="end this session on this device" last>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/signin" })}
                style={styles.signOutButton}
                aria-label="Sign out"
              >
                <LogOut size={12} />
                <span>Sign out</span>
              </button>
            </SettingRow>
          </div>

          {/* ── Admin (mobile-only — desktop has the sidebar entry) ───── */}
          {isAdmin && (
            <div className="preferences-mobile-only">
              <SectionHead label="Admin" sub="operator tools" />
              <div style={styles.card}>
                <SettingRow
                  label="Admin dashboard"
                  description="ingest jobs, backfills, scrapers"
                  last
                >
                  <Link
                    href="/admin"
                    style={styles.signOutButton}
                    aria-label="Open admin dashboard"
                  >
                    <ShieldCheck size={12} />
                    <span>Open admin</span>
                  </Link>
                </SettingRow>
              </div>
            </div>
          )}

          {/* ── Appearance ───────────────────────────── */}
          <SectionHead label="Appearance" sub="theme and display" />
          <div style={styles.card}>
            <SettingRow label="Theme" description="applies to all pages">
              <SegmentedControl
                options={themeConverter.options}
                selected={themeConverter.toDisplay(currentTheme)}
                onChange={(value) => {
                  const t = themeConverter.fromDisplay(value);
                  setTheme(t);
                  updatePrefs.mutate({ theme: t });
                }}
              />
            </SettingRow>

            <SettingRow
              label="Compact mode"
              description="denser rows in list views"
            >
              <Toggle
                checked={prefs?.compactMode ?? false}
                onChange={(value) => updatePrefs.mutate({ compactMode: value })}
                disabled={updatePrefs.isPending}
              />
            </SettingRow>

            {/* Phase 11 §15o — spoiler-blur preference. 'Style default'
                respects the per-prediction blur (stable + theatrical
                default ON; rotating + improvised default OFF).
                'Always blur' / 'Never blur' force the behavior across
                the predicted-setlist tab AND the daily digest tile. */}
            <SettingRow
              label="Setlist spoilers"
              description="blur predicted song titles until you reveal"
              last
            >
              <SegmentedControl
                options={setlistSpoilersConverter.options}
                selected={setlistSpoilersConverter.toDisplay(
                  prefs?.setlistSpoilers ?? "style_default",
                )}
                onChange={(value) =>
                  updatePrefs.mutate({
                    setlistSpoilers: setlistSpoilersConverter.fromDisplay(value),
                  })
                }
              />
            </SettingRow>
          </div>

          {/* ── Notifications ────────────────────────── */}
          <SectionHead label="Notifications" sub="how and when we reach you" />
          <div style={styles.card}>
            <SettingRow
              label="Email notifications"
              description="daily digest of your shows and announcements from your followed regions, at 8 AM ET"
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
              last
            >
              <Toggle
                checked={prefs?.pushNotifications ?? false}
                onChange={(value) =>
                  updatePrefs.mutate({ pushNotifications: value })
                }
                disabled={updatePrefs.isPending}
              />
            </SettingRow>
          </div>

          {/* ── Regions ──────────────────────────────── */}
          <div id="regions" style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18 }}>
            <div>
              <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 11, color: "var(--ink)", letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 500 }}>
                Regions
              </div>
              <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: "var(--faint)", marginTop: 3, letterSpacing: ".04em" }}>
                where to look for nearby shows · powers your daily digest
              </div>
            </div>
            <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: !canAddEntity("regions", regions.length) ? "#E63946" : "var(--muted)", letterSpacing: ".04em", marginLeft: "auto" }}>
              {regions.length} / {entityLimit("regions")} regions
            </div>
          </div>
          <div style={{ ...styles.card, padding: "16px 20px", marginBottom: 36 }}>
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
                  {canAddEntity("regions", regions.length) ? (
                    <AddRegionForm onAdd={() => prefsQuery.refetch()} />
                  ) : (
                    <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".04em", marginTop: 12 }}>
                      {entityLimitReachedHint("regions")}
                    </div>
                  )}
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
                {venues
                  .slice(venuePage * VENUES_PER_PAGE, (venuePage + 1) * VENUES_PER_PAGE)
                  .map(
                    (
                      venue: { id: string; name: string; city?: string },
                      i: number,
                      pageVenues: { id: string; name: string; city?: string }[]
                    ) => (
                      <div
                        key={venue.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 0",
                          borderBottom:
                            i < pageVenues.length - 1
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
                {venues.length > VENUES_PER_PAGE && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid var(--rule)", marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => setVenuePage((p) => Math.max(0, p - 1))}
                      disabled={venuePage === 0}
                      style={{ ...styles.unfollowButton, opacity: venuePage === 0 ? 0.3 : 1 }}
                    >
                      &larr; Prev
                    </button>
                    <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: "var(--faint)" }}>
                      {venuePage * VENUES_PER_PAGE + 1}–{Math.min((venuePage + 1) * VENUES_PER_PAGE, venues.length)} of {venues.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setVenuePage((p) => p + 1)}
                      disabled={(venuePage + 1) * VENUES_PER_PAGE >= venues.length}
                      style={{ ...styles.unfollowButton, opacity: (venuePage + 1) * VENUES_PER_PAGE >= venues.length ? 0.3 : 1 }}
                    >
                      Next &rarr;
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p style={styles.emptyText}>
                You&apos;re not following any venues yet
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              {canAddEntity("venues", venues.length) ? (
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
              ) : (
                <div style={{ padding: "12px 0", fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".04em" }}>
                  {entityLimitReachedHint("venues")}
                </div>
              )}
              <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: !canAddEntity("venues", venues.length) ? "#E63946" : "var(--faint)", letterSpacing: ".04em" }}>
                {venues.length} / {entityLimit("venues")} venues
              </div>
            </div>
          </div>

          {showFollowModal && (
            <VenueFollowModal
              onClose={() => setShowFollowModal(false)}
              onFollowed={() => {
                venuesQuery.refetch();
                utils.discover.followedFeed.invalidate();
                utils.discover.nearbyFeed.invalidate();
                setShowFollowModal(false);
              }}
            />
          )}

          {/* ── Spotify import ───────────────────────── */}
          <SectionHead
            label="Followed artists"
            sub="import from Spotify or follow individual artists"
          />
          <SpotifyImport />
          <div style={styles.card}>
            {followedArtists.length > 0 ? (
              <>
                {followedArtists
                  .slice(artistPage * ARTISTS_PER_PAGE, (artistPage + 1) * ARTISTS_PER_PAGE)
                  .map((artist, i, pageArtists) => (
                    <div
                      key={artist.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 0",
                        borderBottom:
                          i < pageArtists.length - 1
                            ? "1px solid var(--rule)"
                            : "none",
                      }}
                    >
                      <Music size={14} color="var(--faint)" />
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
                          {artist.name}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          unfollowArtist.mutate({ performerId: artist.id })
                        }
                        disabled={unfollowArtist.isPending}
                        style={styles.unfollowButton}
                      >
                        {unfollowArtist.isPending ? "..." : "Unfollow"}
                      </button>
                    </div>
                  ))}
                {followedArtists.length > ARTISTS_PER_PAGE && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid var(--rule)", marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => setArtistPage((p) => Math.max(0, p - 1))}
                      disabled={artistPage === 0}
                      style={{ ...styles.unfollowButton, opacity: artistPage === 0 ? 0.3 : 1 }}
                    >
                      &larr; Prev
                    </button>
                    <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: "var(--faint)" }}>
                      {artistPage * ARTISTS_PER_PAGE + 1}–{Math.min((artistPage + 1) * ARTISTS_PER_PAGE, followedArtists.length)} of {followedArtists.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setArtistPage((p) => p + 1)}
                      disabled={(artistPage + 1) * ARTISTS_PER_PAGE >= followedArtists.length}
                      style={{ ...styles.unfollowButton, opacity: (artistPage + 1) * ARTISTS_PER_PAGE >= followedArtists.length ? 0.3 : 1 }}
                    >
                      Next &rarr;
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p style={styles.emptyText}>
                You&apos;re not following any artists yet
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              {canAddEntity("artists", followedArtists.length) ? (
                <div
                  onClick={() => setShowArtistFollowModal(true)}
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
                  <Plus size={11} color="var(--accent)" /> Follow an artist
                </div>
              ) : (
                <div style={{ padding: "12px 0", fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".04em" }}>
                  {entityLimitReachedHint("artists")}
                </div>
              )}
              <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10.5, color: !canAddEntity("artists", followedArtists.length) ? "#E63946" : "var(--faint)", letterSpacing: ".04em" }}>
                {followedArtists.length} / {entityLimit("artists")} artists
              </div>
            </div>
          </div>

          {showArtistFollowModal && (
            <ArtistFollowModal
              onClose={() => setShowArtistFollowModal(false)}
              onFollowed={() => {
                followedArtistsQuery.refetch();
                utils.discover.followedArtistsFeed.invalidate();
                utils.performers.followed.invalidate();
                setShowArtistFollowModal(false);
              }}
            />
          )}

          {/* ── Built-in integrations ─────────────────── */}
          <SectionHead
            label="Built-in integrations"
            sub="shared, app-wide data sources — not tied to your account"
          />
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

          {/* ── Your data (export) ──────────────────────────────────── */}
          <SectionHead label="Your data" sub="portable, in your hands" />
          <div style={styles.card}>
            <SettingRow
              label="Download your data"
              description="JSON export of every show, follow, region, preference, and media tag"
              last
            >
              {/* Anchor + `download` attribute so the browser uses its
                  native save flow against the REST endpoint's
                  Content-Disposition. Open in same tab — the response
                  triggers a download, not a navigation. */}
              <a
                href="/api/account/export"
                download
                style={styles.signOutButton}
                aria-label="Download a JSON export of your account data"
              >
                <span>Download…</span>
              </a>
            </SettingRow>
          </div>

          {/* ── Danger zone (account deletion) ───────────────────────── */}
          <SectionHead
            label="Danger zone"
            sub="permanent, irreversible actions"
          />
          <div style={styles.card}>
            <SettingRow
              label="Delete account"
              description="erase all shows, follows, integrations, media metadata"
              last
            >
              <button
                type="button"
                onClick={() => setDeleteModalOpen(true)}
                style={styles.deleteButton}
                aria-label="Delete account"
              >
                <span>Delete account…</span>
              </button>
            </SettingRow>
          </div>
        </div>
      </div>
      {deleteModalOpen ? (
        <DeleteAccountModal
          userEmail={userEmail}
          onClose={() => setDeleteModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Typed-confirm modal for irreversible account deletion. The user must
 * type the literal string `DELETE` (matching `z.literal('DELETE')` on
 * the server side) before the destructive button enables.
 */
function DeleteAccountModal({
  userEmail,
  onClose,
}: {
  userEmail: string;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.account.delete.useMutation();
  const canDelete = typed === "DELETE" && !submitting;

  async function handleDelete() {
    if (!canDelete) return;
    setSubmitting(true);
    try {
      await deleteMutation.mutateAsync({ confirmation: "DELETE" });
      toast.success("Account deleted");
      // Clear any cached queries so the post-signout shell has no stale
      // user-scoped data to flash before the route redirect lands.
      utils.invalidate();
      await signOut({ callbackUrl: "/signin" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Delete failed — try again";
      toast.error(message);
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        background: "rgba(0, 0, 0, 0.6)",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--surface)",
          border: "1px solid var(--rule-strong)",
          borderRadius: 12,
          padding: 24,
          display: "grid",
          gap: 16,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <h2
            id="delete-account-title"
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 20,
              fontWeight: 700,
              color: "var(--ink)",
            }}
          >
            Delete your account?
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--muted)",
            }}
          >
            This permanently erases every show, setlist, follow, media
            tag, and integration tied to {userEmail ? <strong style={{ color: "var(--ink)" }}>{userEmail}</strong> : "this account"}. It cannot be undone.
          </p>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label
            htmlFor="delete-account-confirm"
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 11,
              letterSpacing: 0.2,
              textTransform: "uppercase",
              color: "var(--faint)",
            }}
          >
            Type <strong style={{ color: "var(--ink)" }}>DELETE</strong> to confirm
          </label>
          <input
            id="delete-account-confirm"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 6,
              border: "1px solid var(--rule-strong)",
              background: "var(--bg)",
              color: "var(--ink)",
              fontFamily: "var(--font-geist-mono)",
              fontSize: 14,
              letterSpacing: 1,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={styles.signOutButton}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete}
            style={{
              ...styles.deleteButton,
              opacity: canDelete ? 1 : 0.45,
              cursor: canDelete ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? "Deleting…" : "Delete forever"}
          </button>
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
    padding: "16px var(--page-pad-x)",
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
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: 26,
    color: "var(--ink)",
    letterSpacing: "-0.01em",
    lineHeight: 1.1,
    marginTop: 4,
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: "28px var(--page-pad-x) 60px",
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
  signOutButton: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "var(--font-geist-mono)",
    fontSize: 10.5,
    fontWeight: 500,
    color: "var(--ink)",
    background: "transparent",
    border: "1px solid var(--rule-strong)",
    borderRadius: 0,
    padding: "6px 12px",
    cursor: "pointer",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    flexShrink: 0,
  },
  // Destructive variant: red outline + ink-on-danger fill on the
  // submit, matching the existing danger-zone visual treatment in the
  // theatre kind-color (var(--kind-theatre) is a saturated red).
  deleteButton: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "var(--font-geist-mono)",
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--kind-theatre)",
    background: "transparent",
    border: "1px solid var(--kind-theatre)",
    borderRadius: 0,
    padding: "6px 12px",
    cursor: "pointer",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    flexShrink: 0,
  },
};
