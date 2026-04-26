"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { HeroCard } from "@/components/design-system/HeroCard";
import type { ShowKind } from "@/components/design-system/KindBadge";
import {
  ArrowRight,
  ChevronRight,
  Music,
  Clapperboard,
  Laugh,
  Tent,
  Eye,
  Square,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────

const KIND_ICONS: Record<ShowKind, LucideIcon> = {
  concert: Music,
  theatre: Clapperboard,
  comedy: Laugh,
  festival: Tent,
};

const KIND_LABELS: Record<ShowKind, string> = {
  concert: "Concert",
  theatre: "Theatre",
  comedy: "Comedy",
  festival: "Festival",
};

function getHeadliner(
  show: {
    kind?: string;
    productionName?: string | null;
    showPerformers: {
      role: string;
      sortOrder: number;
      performer: { name: string };
    }[];
  }
): string {
  if (show.kind === "theatre" && show.productionName) {
    return show.productionName;
  }
  const headliner = show.showPerformers.find(
    (sp) => sp.role === "headliner" && sp.sortOrder === 1
  );
  if (headliner) return headliner.performer.name;
  const fallback = show.showPerformers.find((sp) => sp.role === "headliner");
  if (fallback) return fallback.performer.name;
  return show.showPerformers[0]?.performer.name ?? "Unknown Artist";
}

function getSupport(
  showPerformers: {
    role: string;
    sortOrder: number;
    performer: { name: string };
  }[]
): string[] {
  return showPerformers
    .filter((sp) => sp.role === "support")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sp) => sp.performer.name);
}

function toDateParts(dateStr: string): {
  month: string;
  day: string;
  year: string;
  dow: string;
} {
  const d = new Date(dateStr);
  return {
    month: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day: String(d.getDate()),
    year: String(d.getFullYear()),
    dow: d.toLocaleDateString("en-US", { weekday: "short" }),
  };
}

function countdownText(dateStr: string): string {
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

function formatMiniDate(dateStr: string): string {
  const parts = toDateParts(dateStr);
  return `${parts.month} ${parts.day}`;
}

// ── Shared style constants ───────────────────────────────────────────────

const MONO = "var(--font-geist-mono), monospace";
const SANS = "var(--font-geist-sans), sans-serif";

// ── Component ────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const { data: shows, isLoading } = trpc.shows.list.useQuery({});

  // Split shows into upcoming and past
  const { upcoming, past, stats } = useMemo(() => {
    if (!shows) return { upcoming: [], past: [], stats: null };

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const upcomingShows = shows
      .filter(
        (s) =>
          (s.state === "ticketed" || s.state === "watching") &&
          new Date(s.date) >= now
      )
      .sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

    const pastShows = shows
      .filter((s) => s.state === "past")
      .sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

    // Compute stats
    const currentYear = new Date().getFullYear();
    const thisYearShows = shows.filter(
      (s) => new Date(s.date).getFullYear() === currentYear
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
      past: pastShows,
      stats: {
        shows: showCount,
        spent: `$${Math.round(totalSpent)}`,
        avgPerShow: `~$${avgPerShow}/show`,
        venues: uniqueVenues.size,
        artists: uniqueArtists.size,
      },
    };
  }, [shows]);

  const heroShow = upcoming[0] ?? null;
  const miniCards = upcoming.slice(1, 4);
  const recentShows = past.slice(0, 5);
  const totalPast = past.length;

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          fontFamily: MONO,
          fontSize: 11,
          color: "var(--muted)",
          letterSpacing: ".06em",
        }}
      >
        Loading...
      </div>
    );
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
          padding: "16px 36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--rule)",
          flexShrink: 0,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".08em",
              textTransform: "uppercase",
            }}
          >
            {formatTopBarDate()}
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 22,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: -0.6,
              marginTop: 3,
            }}
          >
            {getGreeting()}
          </div>
        </div>

        {stats && (
          <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
            {[
              ["Shows", String(stats.shows), "this year"],
              ["Spent", stats.spent, stats.avgPerShow],
              ["Venues", String(stats.venues), "NYC"],
              ["Artists", String(stats.artists), "+ 3 new"],
            ].map(([label, value, subtitle]) => (
              <div
                key={label}
                style={{ display: "flex", flexDirection: "column" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      fontFamily: SANS,
                      fontSize: 22,
                      fontWeight: 500,
                      color: "var(--ink)",
                      letterSpacing: -0.6,
                      lineHeight: 1,
                      fontFeatureSettings: '"tnum"',
                    }}
                  >
                    {value}
                  </div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      color: "var(--faint)",
                      letterSpacing: ".04em",
                    }}
                  >
                    {subtitle}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    color: "var(--muted)",
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    marginTop: 4,
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
              Next up
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                color: "var(--faint)",
              }}
            >
              {heroShow
                ? `${countdownText(heroShow.date)} · doors 7:00 pm`
                : "nothing scheduled"}
            </div>
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
                support: getSupport(heroShow.showPerformers),
                venue: heroShow.venue.name,
                city: [heroShow.venue.city, heroShow.venue.stateRegion]
                  .filter(Boolean)
                  .join(", "),
                seat: heroShow.seat ?? "",
                paid: heroShow.pricePaid
                  ? parseFloat(heroShow.pricePaid)
                  : 0,
                kind: heroShow.kind as ShowKind,
                date: toDateParts(heroShow.date),
                countdown: countdownText(heroShow.date),
                hasTix: heroShow.state === "ticketed",
              }}
            />
          ) : (
            <div
              style={{
                padding: "40px 32px",
                background: "var(--surface)",
                borderLeft: "3px solid var(--rule)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 16,
                  color: "var(--muted)",
                }}
              >
                No upcoming shows — add one!
              </div>
            </div>
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
                        fontFamily: SANS,
                        fontSize: 16,
                        fontWeight: 600,
                        letterSpacing: -0.35,
                        color: "var(--ink)",
                        lineHeight: 1.15,
                        marginTop: 6,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {getHeadliner(u)}
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
                      {u.venue.name}
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
                const support = getSupport(s.showPerformers);
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
                    onClick={() => router.push("/shows")}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "72px 110px 1fr 1fr 110px 64px 28px",
                      columnGap: 16,
                      padding: "14px 20px",
                      borderBottom: "1px solid var(--rule)",
                      alignItems: "center",
                      cursor: "pointer",
                    }}
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
                          fontFamily: SANS,
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--ink)",
                          letterSpacing: -0.2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {headliner}
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
                          + {support.join(", ")}
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
                        {s.venue.name}
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
              <div
                style={{
                  padding: "24px 20px",
                  fontFamily: SANS,
                  fontSize: 13,
                  color: "var(--muted)",
                  textAlign: "center",
                }}
              >
                No past shows yet
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
