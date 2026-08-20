"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { EmptyState, HeroCard, KindSwatch } from "@/components/design-system";
import {
  GetStartedHub,
  useGetStartedDismissed,
  type GetStartedStep,
} from "@/components/home/GetStartedHub";
import "@/components/design-system/design-system.css";
import type { ShowKind } from "@/components/design-system/KindBadge";
import {
  ChevronRight,
} from "lucide-react";
import {
  applyEffectiveShowState,
  formatDateParts as toDateParts,
  parseLocalDate,
} from "@showbook/shared";
import { countdownText } from "@/lib/countdown";
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

function formatMiniDate(dateStr: string | null): string {
  if (!dateStr) return "TBD";
  const parts = toDateParts(dateStr);
  return `${parts.month} ${parts.day}`;
}

// ── Shared style constants ───────────────────────────────────────────────

const SANS = "var(--font-geist-sans), sans-serif";

// ── Component ────────────────────────────────────────────────────────────

export default function HomeView() {
  const router = useRouter();
  const { data: shows, isLoading } = trpc.shows.list.useQuery({});
  const { data: followedArtists } = trpc.performers.followed.useQuery();
  const { data: followedVenues } = trpc.venues.followed.useQuery();
  const { data: prefs } = trpc.preferences.get.useQuery();
  const { dismissed, dismiss } = useGetStartedDismissed();
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
  const { upcoming, past, stats } = useMemo(() => {
    if (!shows || !mounted)
      return { upcoming: [], dateTbd: [], past: [], stats: null };

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Effective state first: a ticketed show flips to past 3 h after its
    // doors anchor, so tonight's show moves from Next up to Recently
    // attended the same evening instead of after the nightly transition.
    const effShows = shows.map((s) => applyEffectiveShowState(s));

    const upcomingShows = effShows
      .filter(
        (s) =>
          (s.state === "ticketed" || s.state === "watching") &&
          s.date !== null &&
          parseLocalDate(s.date) >= now
      )
      .sort(
        (a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime()
      );

    // Watching shows from a multi-night run that haven't had a date picked
    // yet — surface them in their own rail so the user can pick a date.
    const dateTbdShows = effShows
      .filter((s) => s.state === "watching" && s.date === null)
      .sort((a, b) => {
        const aHl = a.showPerformers?.[0]?.performer?.name ?? a.productionName ?? "";
        const bHl = b.showPerformers?.[0]?.performer?.name ?? b.productionName ?? "";
        return aHl.localeCompare(bHl);
      });

    const pastShows = effShows
      .filter((s) => s.state === "past" && s.date !== null)
      .sort(
        (a, b) => new Date(b.date!).getTime() - new Date(a.date!).getTime()
      );

    // Compute stats — exclude dateless watching rows since they have no year.
    const currentYear = new Date().getFullYear();
    const thisYearShows = shows.filter(
      (s) => s.date !== null && parseLocalDate(s.date).getFullYear() === currentYear
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
      <div style={{ padding: "14px var(--page-pad-x)", borderBottom: "1px solid var(--rule)", flexShrink: 0, height: 52 }} />
      <div style={{ flex: 1, minHeight: 0, padding: "28px var(--page-pad-x) 40px", display: "grid", gap: 28, alignContent: "start" }}>
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
  // Setup checklist. The card stays above the dashboard until every step
  // is done (or the user dismisses it) — each step is tracked against
  // live data so finishing one elsewhere checks it off here.
  const hasFollows =
    (followedArtists?.length ?? 0) > 0 || (followedVenues?.length ?? 0) > 0;
  const hasRegion = (prefs?.regions?.length ?? 0) > 0;
  const checklistSteps: GetStartedStep[] = [
    { id: "add", label: "Add your first show", done: !noShows, href: "/add" },
    {
      id: "follow",
      label: "Follow an artist or venue",
      done: hasFollows,
      href: "/discover",
    },
    {
      id: "region",
      label: "Set a home region",
      done: hasRegion,
      href: "/discover?tab=regions",
    },
  ];
  // Wait for all three queries before showing the card so a cold load
  // doesn't flash unchecked steps at a fully set-up user.
  const checklistReady =
    followedArtists !== undefined &&
    followedVenues !== undefined &&
    prefs !== undefined;
  const showHubCard =
    !dismissed &&
    !noShows &&
    checklistReady &&
    checklistSteps.some((s) => !s.done);

  if (noShows) {
    return (
      <div
        data-testid="home-empty-state"
        style={{ height: "100%", overflowY: "auto" }}
      >
        <GetStartedHub variant="expanded" />
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
      <div className="home-topbar">
        {/* Page title. This used to be a repeat of the sidebar wordmark
            (music note + "showbook" set in mono); the redesign gives Home
            the same plain title every other screen has. */}
        <h1
          data-testid="home-wordmark"
          className="home-topbar__wordmark"
          style={{
            fontFamily: SANS,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            color: "var(--ink)",
          }}
        >
          Home
        </h1>

        {stats && (
          <div
            data-testid="home-stats"
            aria-label="This year summary"
            className="home-topbar__stats"
          >
            <div className="home-topbar__stats-year">This year</div>
            {[
              { label: "shows", value: String(stats.shows) },
              { label: "venues", value: String(stats.venues) },
              { label: "artists", value: String(stats.artists) },
            ].map(({ label, value }) => (
              <div key={label} className="home-topbar__stat">
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--ink)",
                    lineHeight: 1,
                    letterSpacing: "-0.025em",
                  }}
                >
                  {value}
                </div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 12.5,
                    color: "var(--muted)",
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
          padding: "28px var(--page-pad-x) 40px",
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 28,
          alignContent: "start",
        }}
      >
        {showHubCard && (
          <GetStartedHub
            variant="card"
            onDismiss={dismiss}
            steps={checklistSteps}
          />
        )}
        {/* ── NEXT UP Section ─────────────────────────────── */}
        <section>
          {/* Section header — eyebrow on the left, "see all" link on the
              right. The eyebrow used to be a pulsing accent label inside the
              hero card itself; it reads better as quiet sentence-case text
              above the card, which lets the hero open on the headliner. */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginBottom: 12,
              minHeight: 16,
            }}
          >
            <div style={{ flex: 1, fontFamily: SANS, fontSize: 12.5, color: "var(--muted)" }}>
              {heroShow ? `Next up · ${countdownText(heroShow.date)}` : null}
            </div>
            {upcoming.length > 0 && (
              <div
                onClick={() => router.push("/upcoming")}
                style={{
                  fontFamily: SANS,
                  fontSize: 12.5,
                  color: "var(--ink)",
                  textDecoration: "underline",
                  textDecorationColor: "var(--rule-strong)",
                  textUnderlineOffset: 3,
                  cursor: "pointer",
                }}
              >
                See all {upcoming.length} upcoming
              </div>
            )}
          </div>

          {/* Hero card */}
          {heroShow ? (
            <HeroCard
              show={{
                id: heroShow.id,
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
                dateYmd: heroShow.date,
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

          {/* Mini upcoming cards (3 columns on desktop, stacked on mobile) */}
          {miniCards.length > 0 && (
            <div
              className="home-mini-cards"
              style={
                {
                  ["--mini-card-count" as string]: String(miniCards.length),
                } as React.CSSProperties
              }
            >
              {miniCards.map((u) => {
                const kind = u.kind as ShowKind;
                const kindColor = `var(--kind-${kind})`;
                const hasTix = u.state === "ticketed";

                return (
                  <div
                    key={u.id}
                    data-testid="upcoming-mini-card"
                    data-show-id={u.id}
                    onClick={() => router.push(`/shows/${u.id}`)}
                    style={{
                      padding: "14px 18px",
                      background: "var(--surface)",
                      borderLeft: `2px solid ${kindColor}`,
                      cursor: "pointer",
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
                      <KindSwatch kind={kind} />
                      {/* State — a word, not a filled chip. Gold is reserved
                          for the Add-a-show button; ticketed reads as emphasis
                          through weight and `--accent-strong`. */}
                      <span
                        style={{
                          fontFamily: SANS,
                          fontSize: 12.5,
                          fontWeight: hasTix ? 500 : 400,
                          color: hasTix
                            ? "var(--accent-strong)"
                            : "var(--muted)",
                        }}
                      >
                        {hasTix ? "Ticketed" : "Watching"}
                      </span>
                    </div>

                    {/* Headliner */}
                    <div
                      style={{
                        fontFamily: SANS,
                        fontSize: 17,
                        fontWeight: 600,
                        letterSpacing: "-0.025em",
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
                            onClick={(e) => e.stopPropagation()}
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
                        fontSize: 12.5,
                        color: "var(--muted)",
                        marginTop: 3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      <Link
                        href={`/venues/${u.venue.id}`}
                        onClick={(e) => e.stopPropagation()}
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
                          fontFamily: SANS,
                          fontSize: 11.5,
                          color: "var(--ink)",
                          fontWeight: 500,
                        }}
                      >
                        {formatMiniDate(u.date)}
                      </span>
                      <span
                        style={{
                          fontFamily: SANS,
                          fontSize: 11.5,
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
                fontFamily: SANS,
                fontSize: 12.5,
                color: "var(--ink)",
                fontWeight: 600,
              }}
            >
              Recent
            </div>
            <div
              style={{
                fontFamily: SANS,
                fontSize: 12.5,
                color: "var(--muted)",
              }}
            >
              Last 5 of {totalPast}
            </div>
            <div style={{ flex: 1 }} />
            <div
              onClick={() => router.push("/logbook")}
              style={{
                fontFamily: SANS,
                fontSize: 12.5,
                color: "var(--ink)",
                textDecoration: "underline",
                textDecorationColor: "var(--rule-strong)",
                textUnderlineOffset: 3,
                cursor: "pointer",
              }}
            >
              Open in Shows
            </div>
          </div>

          {/* Recent table */}
          <div style={{ background: "var(--surface)" }}>
            {/* Column headers — hidden on mobile (3-col layout is self-evident). */}
            <div className="home-recent-headers">
              <div>Date</div>
              <div>Kind</div>
              <div>Headline</div>
              <div>Venue</div>
              <div />
            </div>

            {/* Rows */}
            {recentShows.length > 0 ? (
              recentShows.map((s) => {
                const kind = s.kind as ShowKind;
                const kindColor = `var(--kind-${kind})`;
                const dateParts = toDateParts(s.date);
                const headliner = getHeadliner(s);
                const headlinerId = getHeadlinerId(s);
                const support = getSupport(s);
                const supportPerformers = getSupportPerformers(s);
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
                    className="home-recent-row"
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    {/* Date — one line, `Aug 16 '26`. The two-line
                        `AUG 16 / 2026 · sun` stack made every past row as tall
                        as a hero date. */}
                    <div
                      style={{
                        fontFamily: SANS,
                        fontSize: 14,
                        color: "var(--ink)",
                        fontWeight: 500,
                        letterSpacing: "-0.025em",
                        lineHeight: 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {dateParts.month} {dateParts.day}{" "}
                      <span style={{ color: "var(--faint)" }}>
                        &rsquo;{dateParts.year.slice(-2)}
                      </span>
                    </div>

                    {/* Kind — desktop only; on mobile we show the kind icon
                        next to the venue name to keep the row to 3 cols. */}
                    <div className="desktop-only">
                      <KindSwatch kind={kind} />
                    </div>

                    {/* Headline + support */}
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: SANS,
                          fontSize: 15,
                          fontWeight: 600,
                          color: "var(--ink)",
                          letterSpacing: "-0.025em",
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
                      {/* Mobile-only venue line under the headliner. The
                          row itself navigates to the show detail, so the
                          venue is rendered as plain text — wrapping it in
                          a Link with stopPropagation made tapping the row
                          ambiguous and intermittently swallowed the click. */}
                      <div
                        className="mobile-only"
                        style={{
                          display: "inline-flex",
                          fontFamily: SANS,
                          fontSize: 12.5,
                          color: "var(--muted)",
                          marginTop: 4,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          alignItems: "center",
                          gap: 6,
                          maxWidth: "100%",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 5,
                            height: 5,
                            flexShrink: 0,
                            background: kindColor,
                          }}
                        />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          {s.venue.name}
                        </span>
                      </div>
                    </div>

                    {/* Venue — desktop only; mobile merges venue into the headline cell. */}
                    <div className="desktop-only" style={{ minWidth: 0 }}>
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
                            fontFamily: SANS,
                            fontSize: 11.5,
                            color: "var(--muted)",
                            marginTop: 2,
                          }}
                        >
                          {neighborhood.toLowerCase()}
                        </div>
                      )}
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
