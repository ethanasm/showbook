"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useCompactMode } from "@/lib/useCompactMode";
import { EmptyState, HeroCard } from "@/components/design-system";
import type { ShowKind } from "@/components/design-system/KindBadge";
import {
  ArrowRight,
  ChevronRight,
  Music,
  Eye,
  Square,
} from "lucide-react";
import { formatDateParts as toDateParts } from "@showbook/shared";
import { KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";
import {
  getHeadliner,
  getHeadlinerId,
  getHeadlinerImageUrl,
  getSupport,
  getSupportPerformers,
} from "@/lib/show-accessors";
import {
  useShowContextMenu,
  type ShowForContextMenu,
} from "@/lib/useShowContextMenu";

// ── Helpers ──────────────────────────────────────────────────────────────

function countdownText(dateStr: string | null): string {
  if (!dateStr) return "date TBD";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const days = Math.ceil(
    (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days === 0) return "tonight";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatTopBarDate(): string {
  const d = new Date();
  const dow = d
    .toLocaleDateString("en-US", { weekday: "short" })
    .toLowerCase();
  const day = d.getDate();
  const month = d
    .toLocaleDateString("en-US", { month: "short" })
    .toLowerCase();
  const year = d.getFullYear();
  return `${dow} · ${day} ${month} · ${year}`;
}

function formatMiniDate(dateStr: string | null): string {
  if (!dateStr) return "TBD";
  const parts = toDateParts(dateStr);
  return `${parts.month} ${parts.day}`;
}

// ── Shared style constants ───────────────────────────────────────────────

const MONO = "var(--font-geist-mono), monospace";
const SANS = "var(--font-geist-sans), sans-serif";

// ── Component ────────────────────────────────────────────────────────────

export default function HomeView() {
  const router = useRouter();
  const compact = useCompactMode();
  const { data: shows, isLoading } = trpc.shows.list.useQuery({});
  const {
    openContextMenu: handleRecentContextMenu,
    portal: showContextMenuPortal,
  } = useShowContextMenu<ShowForContextMenu>();

  // Today's date and current year are read from `new Date()`, which differs
  // between the SSR host (often UTC) and the client (user's local TZ). Gate
  // any render that depends on them on `mounted` so SSR and the first client
  // render both produce the skeleton — preventing a hydration mismatch when
  // a show's date sits on the day boundary between the two zones.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Split shows into upcoming and past
  const { upcoming, dateTbd, past, stats } = useMemo(() => {
    if (!shows || !mounted)
      return { upcoming: [], dateTbd: [], past: [], stats: null };

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const upcomingShows = shows
      .filter(
        (s) =>
          (s.state === "ticketed" || s.state === "watching") &&
          s.date !== null &&
          new Date(s.date) >= now
      )
      .sort(
        (a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime()
      );

    // Watching shows from a multi-night run that haven't had a date picked
    // yet — surface them in their own rail so the user can pick a date.
    const dateTbdShows = shows
      .filter((s) => s.state === "watching" && s.date === null)
      .sort((a, b) => {
        const aHl = a.showPerformers?.[0]?.performer?.name ?? a.productionName ?? "";
        const bHl = b.showPerformers?.[0]?.performer?.name ?? b.productionName ?? "";
        return aHl.localeCompare(bHl);
      });

    const pastShows = shows
      .filter((s) => s.state === "past" && s.date !== null)
      .sort(
        (a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime()
      );

    // Compute stats — exclude dateless watching rows since they have no year.
    const currentYear = new Date().getFullYear();
    const thisYearShows = shows.filter(
      (s) => s.date !== null && new Date(s.date).getFullYear() === currentYear
    );
    const totalSpent = thisYearShows.reduce((sum, s) => {
      return sum + (s.pricePaid ? parseFloat(s.pricePaid) : 0);
    }, 0);
    const showCount = thisYearShows.length;
    const avgPerShow =
      showCount > 0 ? Math.round(totalSpent / showCount) : 0;

    const uniqueVenues = new Set(thisYearShows.map((s) => s.venue?.name));
    const uniqueArtists = new Set<string>();
    thisYearShows.forEach((s) => {
      s.showPerformers.forEach((sp) => {
        uniqueArtists.add(sp.performer.name);
      });
    });

    return {
      upcoming: upcomingShows,
      dateTbd: dateTbdShows,
      past: pastShows,
      stats: {
        shows: showCount,
        spent: `$${Math.round(totalSpent)}`,
        avgPerShow: `~$${avgPerShow}/show`,
        venues: uniqueVenues.size,
        artists: uniqueArtists.size,
      },
    };
  }, [shows, mounted]);

  const heroShow = upcoming[0] ?? null;
  const miniCards = upcoming.slice(1, 4);
  const recentShows = past.slice(0, 5);
  const totalPast = past.length;

  const skeleton = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* skeleton top bar */}
      <div style={{ padding: "14px 36px", borderBottom: "1px solid var(--rule)", flexShrink: 0, height: 52 }} />
      <div style={{ flex: 1, minHeight: 0, padding: "28px 36px 40px", display: "grid", gap: 28, alignContent: "start" }}>
        {/* skeleton hero */}
        <div style={{ height: 148, background: "var(--surface)", borderLeft: "3px solid var(--rule)" }} />
        {/* skeleton mini cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "var(--rule)" }}>
          {[0,1,2].map((i) => (
            <div key={i} style={{ height: 80, background: "var(--surface)" }} />
          ))}
        </div>
        {/* skeleton recent rows */}
        <div style={{ background: "var(--surface)" }}>
          {[0,1,2,3,4].map((i) => (
            <div key={i} style={{ height: 48, borderBottom: "1px solid var(--rule)", background: "var(--surface)" }} />
          ))}
        </div>
      </div>
    </div>
  );

  if (isLoading) {
    return skeleton;
  }

  const noShows = !isLoading && shows !== undefined && shows.length === 0;

  if (noShows) {
    return (
      <div
        data-testid="home-empty-state"
        style={{
          height: "100%",
          padding: "40px 24px",
          display: "grid",
          placeItems: "center",
        }}
      >
        <EmptyState
          kind="shows"
          title="Start your logbook"
          body="Add the first show you saw, the next one you are watching, or import ticket history from Gmail."
          action={
            <button
              type="button"
              onClick={() => router.push("/shows?gmail=1")}
              style={{
                padding: "10px 18px",
                background: "var(--accent)",
                color: "var(--accent-text)",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Image src="/google-g.svg" alt="" width={14} height={14} />
              Import from Gmail
            </button>
          }
        />
      </div>
    );
  }

  // Real content depends on `new Date()` (today's date, current year), which
  // resolves differently on the SSR host and in the browser. Render the
  // skeleton on the server and on the first client render so hydration
  // matches; the effect above flips `mounted` and re-renders with real data.
  if (!mounted) {
    return skeleton;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────── */}
      <div
        style={{
          padding: "14px 36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--rule)",
          flexShrink: 0,
        }}
      >
        {/* Wordmark */}
        <div data-testid="home-wordmark" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Music size={15} color="var(--accent)" strokeWidth={2} />
          <span
            style={{
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: ".06em",
            }}
          >
            showbook
          </span>
        </div>

        {stats && (
          <div
            data-testid="home-stats"
            aria-label="This year summary"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 0,
              padding: 4,
              border: "1px solid var(--rule)",
              borderRadius: 999,
              background: "rgba(245,245,243,.035)",
              boxShadow: "inset 0 1px 0 rgba(245,245,243,.04)",
            }}
          >
            <div
              style={{
                padding: "0 12px 0 10px",
                fontFamily: MONO,
                fontSize: 9.5,
                color: "var(--faint)",
                lineHeight: 1,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {new Date().getFullYear()}
            </div>
            {[
              { label: "Shows", value: String(stats.shows) },
              { label: "Venues", value: String(stats.venues) },
              { label: "Artists", value: String(stats.artists) },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                  padding: "6px 13px",
                  borderLeft: "1px solid var(--rule)",
                  whiteSpace: "nowrap",
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 16,
                    fontWeight: 650,
                    color: "var(--ink)",
                    lineHeight: 1,
                    letterSpacing: 0,
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {value}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 9.5,
                    color: "var(--muted)",
                    letterSpacing: ".06em",
                    lineHeight: 1,
                  }}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Canvas (scrollable) ─────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "28px 36px 40px",
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 28,
          alignContent: "start",
        }}
      >
        {/* ── NEXT UP Section ─────────────────────────────── */}
        <section>
          {/* Section header — the "Next up · in N days …" pulse label lives
              inside HeroCard itself; this row is just the right-aligned
              "see all N upcoming" link. */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginBottom: 12,
              minHeight: 16,
            }}
          >
            <div style={{ flex: 1 }} />
            {upcoming.length > 0 && (
              <div
                onClick={() => router.push("/shows")}
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: "var(--accent)",
                  letterSpacing: ".04em",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
              >
                see all {upcoming.length} upcoming{" "}
                <ArrowRight size={11} color="var(--accent)" />
              </div>
            )}
          </div>

          {/* Hero card */}
          {heroShow ? (
            <HeroCard
              show={{
                headliner: getHeadliner(heroShow),
                headlinerId: getHeadlinerId(heroShow),
                support: getSupport(heroShow),
                supportPerformers: getSupportPerformers(heroShow),
                venue: heroShow.venue.name,
                venueId: heroShow.venue.id,
                city: [heroShow.venue.city, heroShow.venue.stateRegion]
                  .filter(Boolean)
                  .join(", "),
                seat: heroShow.seat ?? "",
                paid: heroShow.pricePaid
                  ? parseFloat(heroShow.pricePaid)
                  : 0,
                kind: heroShow.kind as ShowKind,
                // Hero card has its own null-date display style — preserve
                // the prior fallback so a date-less hero looks unchanged.
                date: toDateParts(heroShow.date, {
                  month: "TBD",
                  day: "—",
                  year: "",
                  dow: "",
                }),
                countdown: countdownText(heroShow.date),
                hasTix: heroShow.state === "ticketed",
                headlinerImageUrl: getHeadlinerImageUrl(heroShow),
              }}
            />
          ) : (
            <EmptyState
              kind="shows"
              title="No upcoming shows"
              body="Your next ticketed or watched show will land here with the date, venue, and countdown."
            />
          )}

          {/* Mini upcoming cards (3 columns) */}
          {miniCards.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${miniCards.length}, 1fr)`,
                gap: 1,
                marginTop: 1,
                background: "var(--rule)",
              }}
            >
              {miniCards.map((u) => {
                const kind = u.kind as ShowKind;
                const kindColor = `var(--kind-${kind})`;
                const KindIcon = KIND_ICONS[kind];
                const hasTix = u.state === "ticketed";

                return (
                  <div
                    key={u.id}
                    style={{
                      padding: "14px 18px",
                      background: "var(--surface)",
                      borderLeft: `2px solid ${kindColor}`,
                    }}
                  >
                    {/* Top row: kind badge + state */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontFamily: MONO,
                          fontSize: 10,
                          color: kindColor,
                          letterSpacing: ".1em",
                          textTransform: "uppercase",
                          fontWeight: 500,
                        }}
                      >
                        <KindIcon size={11} color={kindColor} />
                        {KIND_LABELS[kind]}
                      </span>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          color: hasTix
                            ? "var(--accent)"
                            : "var(--muted)",
                          letterSpacing: ".04em",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        {hasTix ? (
                          <>
                            <Square
                              size={8}
                              fill="var(--accent)"
                              color="var(--accent)"
                            />
                            tix
                          </>
                        ) : (
                          <>
                            <Eye size={10} color="var(--muted)" />
                            watching
                          </>
                        )}
                      </span>
                    </div>

                    {/* Headliner */}
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: 16,
                        fontWeight: 700,
                        letterSpacing: "-0.01em",
                        color: "var(--ink)",
                        lineHeight: 1.1,
                        marginTop: 6,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {(() => {
                        const id = getHeadlinerId(u);
                        const name = getHeadliner(u);
                        return id ? (
                          <Link
                            href={`/artists/${id}`}
                            style={{ color: "inherit", textDecoration: "none" }}
                            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                          >
                            {name}
                          </Link>
                        ) : name;
                      })()}
                    </div>

                    {/* Venue */}
                    <div
                      style={{
                        fontFamily: SANS,
                        fontSize: 12,
                        color: "var(--muted)",
                        marginTop: 3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      <Link
                        href={`/venues/${u.venue.id}`}
                        style={{ color: "inherit", textDecoration: "none" }}
                        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                      >
                        {u.venue.name}
                      </Link>
                    </div>

                    {/* Bottom: date + countdown */}
                    <div
                      style={{
                        marginTop: 10,
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 11,
                          color: "var(--ink)",
                          fontWeight: 500,
                        }}
                      >
                        {formatMiniDate(u.date)}
                      </span>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          color: "var(--faint)",
                        }}
                      >
                        {countdownText(u.date)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── RECENT Section ──────────────────────────────── */}
        <section>
          {/* Section header */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: "var(--ink)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              Recent
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                color: "var(--faint)",
              }}
            >
              last 5 &middot; of {totalPast}
            </div>
            <div style={{ flex: 1 }} />
            <div
              onClick={() => router.push("/shows")}
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                color: "var(--accent)",
                letterSpacing: ".04em",
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              open in Shows{" "}
              <ArrowRight size={11} color="var(--accent)" />
            </div>
          </div>

          {/* Recent table */}
          <div style={{ background: "var(--surface)" }}>
            {/* Column headers */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "72px 110px 1fr 1fr 110px 64px 28px",
                columnGap: 16,
                padding: "10px 20px",
                borderBottom: "1px solid var(--rule)",
                fontFamily: MONO,
                fontSize: 9.5,
                color: "var(--faint)",
                letterSpacing: ".12em",
                textTransform: "uppercase",
              }}
            >
              <div>Date</div>
              <div>Kind</div>
              <div>Headline</div>
              <div>Venue</div>
              <div>Seat</div>
              <div style={{ textAlign: "right" }}>Paid</div>
              <div />
            </div>

            {/* Rows */}
            {recentShows.length > 0 ? (
              recentShows.map((s) => {
                const kind = s.kind as ShowKind;
                const kindColor = `var(--kind-${kind})`;
                const KindIcon = KIND_ICONS[kind];
                const dateParts = toDateParts(s.date);
                const headliner = getHeadliner(s);
                const headlinerId = getHeadlinerId(s);
                const support = getSupport(s);
                const supportPerformers = getSupportPerformers(s);
                const paidDisplay = s.pricePaid
                  ? `$${parseFloat(s.pricePaid)}`
                  : "—";
                const neighborhood = [
                  s.venue.city,
                  s.venue.stateRegion,
                ]
                  .filter(Boolean)
                  .join(", ");

                return (
                  <div
                    key={s.id}
                    data-testid="recent-row"
                    data-show-id={s.id}
                    onClick={() => router.push(`/shows/${s.id}`)}
                    onContextMenu={(e) =>
                      handleRecentContextMenu(e, s as ShowForContextMenu)
                    }
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "72px 110px 1fr 1fr 110px 64px 28px",
                      columnGap: 16,
                      padding: compact ? "6px 20px" : "14px 20px",
                      borderBottom: "1px solid var(--rule)",
                      alignItems: "center",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    {/* Date */}
                    <div>
                      <div
                        style={{
                          fontFamily: SANS,
                          fontSize: 17,
                          color: "var(--ink)",
                          fontWeight: 500,
                          letterSpacing: -0.5,
                          lineHeight: 1,
                          fontFeatureSettings: '"tnum"',
                        }}
                      >
                        {dateParts.month} {dateParts.day}
                      </div>
                      <div
                        style={{
                          fontFamily: MONO,
                          fontSize: 10,
                          color: "var(--faint)",
                          marginTop: 3,
                        }}
                      >
                        {dateParts.year} &middot;{" "}
                        {dateParts.dow.toLowerCase()}
                      </div>
                    </div>

                    {/* Kind */}
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        fontFamily: MONO,
                        fontSize: 10.5,
                        color: kindColor,
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                        fontWeight: 500,
                      }}
                    >
                      <KindIcon size={12} color={kindColor} />
                      {KIND_LABELS[kind]}
                    </div>

                    {/* Headline + support */}
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: 14,
                          fontWeight: 700,
                          color: "var(--ink)",
                          letterSpacing: "-0.01em",
                          lineHeight: 1.1,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {headlinerId ? (
                          <Link
                            href={`/artists/${headlinerId}`}
                            style={{ color: "inherit", textDecoration: "none" }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                          >
                            {headliner}
                          </Link>
                        ) : (
                          headliner
                        )}
                      </div>
                      {support.length > 0 && (
                        <div
                          style={{
                            fontFamily: SANS,
                            fontSize: 11.5,
                            color: "var(--muted)",
                            marginTop: 2,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          +{" "}
                          {support.map((name, i) => {
                            const id = supportPerformers.find((p) => p.name === name)?.id;
                            return (
                              <span key={`${name}-${i}`}>
                                {id ? (
                                  <Link
                                    href={`/artists/${id}`}
                                    style={{ color: "inherit", textDecoration: "none" }}
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                                  >
                                    {name}
                                  </Link>
                                ) : (
                                  name
                                )}
                                {i < support.length - 1 ? ", " : ""}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Venue */}
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: SANS,
                          fontSize: 13,
                          color: "var(--ink)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        <Link
                          href={`/venues/${s.venue.id}`}
                          style={{ color: "inherit", textDecoration: "none" }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                        >
                          {s.venue.name}
                        </Link>
                      </div>
                      {neighborhood && (
                        <div
                          style={{
                            fontFamily: MONO,
                            fontSize: 10.5,
                            color: "var(--muted)",
                            marginTop: 2,
                          }}
                        >
                          {neighborhood.toLowerCase()}
                        </div>
                      )}
                    </div>

                    {/* Seat */}
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        color: "var(--muted)",
                      }}
                    >
                      {s.seat ?? "—"}
                    </div>

                    {/* Paid */}
                    <div
                      style={{
                        textAlign: "right",
                        fontFamily: MONO,
                        fontSize: 12,
                        color: "var(--ink)",
                        fontWeight: 500,
                        fontFeatureSettings: '"tnum"',
                      }}
                    >
                      {paidDisplay}
                    </div>

                    {/* Chevron */}
                    <ChevronRight
                      size={14}
                      color="var(--faint)"
                    />
                  </div>
                );
              })
            ) : (
              <div style={{ padding: 20 }}>
                <EmptyState
                  kind="shows"
                  title="No past shows"
                  body="Once a show is marked attended, it joins your recent history here."
                />
              </div>
            )}
          </div>
        </section>
      </div>
      {showContextMenuPortal}
    </div>
  );
}
