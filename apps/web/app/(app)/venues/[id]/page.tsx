"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  Music,
  Clapperboard,
  Laugh,
  Tent,
  MapPin,
  ChevronRight,
  ArrowUpRight,
  Plus,
  Check,
} from "lucide-react";
import type { ShowKind } from "@/components/design-system";

type Performer = {
  id: string;
  name: string;
  imageUrl: string | null;
};

type ShowPerformer = {
  role: string;
  characterName: string | null;
  sortOrder: number;
  performer: Performer;
};

type ShowRow = {
  id: string;
  kind: ShowKind;
  state: "past" | "ticketed" | "watching";
  date: string;
  endDate: string | null;
  seat: string | null;
  pricePaid: string | null;
  tourName: string | null;
  showPerformers: ShowPerformer[];
};

const KIND_ICONS: Record<
  ShowKind,
  React.ComponentType<{ size?: number; color?: string; className?: string }>
> = {
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

const ON_SALE_STATUS_LABELS: Record<string, string> = {
  announced: "announced",
  on_sale: "on sale",
  sold_out: "sold out",
};

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateParts(dateStr: string): {
  month: string;
  day: string;
  year: string;
  dow: string;
} {
  const d = new Date(dateStr + "T00:00:00");
  return {
    month: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day: String(d.getDate()),
    year: String(d.getFullYear()),
    dow: d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase(),
  };
}

function formatOnSaleDate(value: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getHeadliner(show: ShowRow): string {
  const hl = show.showPerformers.find(
    (sp) => sp.role === "headliner" && sp.sortOrder === 0,
  );
  return (
    hl?.performer.name ??
    show.showPerformers.find((sp) => sp.role === "headliner")?.performer.name ??
    "Unknown"
  );
}

function getSupport(show: ShowRow): string[] {
  return show.showPerformers
    .filter((sp) => sp.role === "support")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sp) => sp.performer.name);
}

export default function VenueDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const venueId = params?.id ?? "";

  const utils = trpc.useUtils();

  const detailQuery = trpc.venues.detail.useQuery(
    { venueId },
    { enabled: Boolean(venueId) },
  );
  const announcementsQuery = trpc.venues.upcomingAnnouncements.useQuery(
    { venueId, limit: 100 },
    { enabled: Boolean(venueId) },
  );
  const userShowsQuery = trpc.venues.userShows.useQuery(
    { venueId },
    { enabled: Boolean(venueId) },
  );

  const followMutation = trpc.venues.follow.useMutation({
    onSuccess: () => {
      utils.venues.detail.invalidate({ venueId });
      utils.venues.followed.invalidate();
      utils.discover.followedFeed.invalidate();
    },
  });

  const unfollowMutation = trpc.venues.unfollow.useMutation({
    onSuccess: () => {
      utils.venues.detail.invalidate({ venueId });
      utils.venues.followed.invalidate();
      utils.discover.followedFeed.invalidate();
    },
  });

  const venue = detailQuery.data;
  const userShows = (userShowsQuery.data ?? []) as ShowRow[];
  const upcoming = announcementsQuery.data ?? [];

  const stats = useMemo(() => {
    const sorted = [...userShows].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0]?.date ?? null;
    const last = sorted[sorted.length - 1]?.date ?? null;
    return { first, last };
  }, [userShows]);

  const followBusy =
    followMutation.isPending || unfollowMutation.isPending;

  function toggleFollow() {
    if (!venue || followBusy) return;
    if (venue.isFollowed) {
      unfollowMutation.mutate({ venueId: venue.id });
    } else {
      followMutation.mutate({ venueId: venue.id });
    }
  }

  if (detailQuery.isLoading) {
    return <CenteredMessage>Loading venue…</CenteredMessage>;
  }

  if (detailQuery.error || !venue) {
    return (
      <CenteredMessage tone="error">
        Couldn&apos;t load venue.{" "}
        <button
          type="button"
          onClick={() => router.push("/discover")}
          style={{
            background: "none",
            border: "none",
            color: "var(--accent)",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "inherit",
            padding: 0,
            marginLeft: 8,
          }}
        >
          back to discover →
        </button>
      </CenteredMessage>
    );
  }

  const locationLine = [
    venue.neighborhood,
    venue.city,
    venue.stateRegion,
    venue.country,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Breadcrumb */}
      <div
        style={{
          padding: "14px 36px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
          letterSpacing: ".04em",
        }}
      >
        <Link
          href="/discover"
          style={{ color: "var(--faint)", textDecoration: "none" }}
        >
          discover
        </Link>
        <ChevronRight size={11} color="var(--faint)" />
        <span style={{ color: "var(--ink)" }}>{venue.name.toLowerCase()}</span>
      </div>

      {/* Hero */}
      <div
        style={{
          padding: "28px 36px 24px",
          borderBottom: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          columnGap: 32,
          alignItems: "end",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <MapPin size={12} /> Venue
          </div>
          <div
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 48,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: -1.6,
              lineHeight: 0.98,
              marginTop: 10,
            }}
          >
            {venue.name}
          </div>
          {locationLine && (
            <div
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 14,
                color: "var(--muted)",
                marginTop: 10,
                letterSpacing: -0.1,
              }}
            >
              {locationLine}
            </div>
          )}
        </div>

        {/* Follow button */}
        <button
          type="button"
          onClick={toggleFollow}
          disabled={followBusy}
          style={{
            padding: "8px 14px",
            border: `1px solid ${venue.isFollowed ? "var(--accent)" : "var(--rule-strong)"}`,
            background: venue.isFollowed ? "var(--accent)" : "transparent",
            color: venue.isFollowed ? "var(--bg)" : "var(--ink)",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            letterSpacing: ".04em",
            cursor: followBusy ? "default" : "pointer",
            opacity: followBusy ? 0.6 : 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {venue.isFollowed ? (
            <>
              <Check size={12} /> Following
            </>
          ) : (
            <>
              <Plus size={12} /> Follow
            </>
          )}
        </button>
      </div>

      {/* Stat bar */}
      <div
        style={{
          padding: "16px 36px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          columnGap: 28,
        }}
      >
        <Stat label="Your shows" value={String(venue.userShowCount)} />
        <Stat label="Upcoming" value={String(venue.upcomingCount)} />
        <Stat
          label="First seen"
          value={stats.first ? formatDateLong(stats.first) : "—"}
        />
        <Stat
          label="Last seen"
          value={stats.last ? formatDateLong(stats.last) : "—"}
        />
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
          padding: "24px 36px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        {/* Upcoming */}
        <section>
          <SectionHeader
            label={`Upcoming · ${upcoming.length}`}
            note="ascending · soonest first"
          />
          {announcementsQuery.isLoading ? (
            <CardMessage>Loading announcements…</CardMessage>
          ) : upcoming.length === 0 ? (
            <CardMessage>No upcoming announcements at this venue.</CardMessage>
          ) : (
            <div style={{ background: "var(--surface)" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 110px 1fr 110px 120px",
                  columnGap: 16,
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--rule)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 9.5,
                  color: "var(--faint)",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                }}
              >
                <div>Show date</div>
                <div>Kind</div>
                <div>Headliner</div>
                <div>On sale</div>
                <div>Status</div>
              </div>
              {upcoming.map((a) => {
                const date = formatDateParts(a.showDate);
                const KindIcon = KIND_ICONS[a.kind as ShowKind];
                const isOnSale = a.onSaleStatus === "on_sale";
                return (
                  <div
                    key={a.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "100px 110px 1fr 110px 120px",
                      columnGap: 16,
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--rule)",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 12,
                          color: "var(--ink)",
                          letterSpacing: ".02em",
                          fontFeatureSettings: '"tnum"',
                        }}
                      >
                        {date.month} {date.day}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 10,
                          color: "var(--muted)",
                          marginTop: 2,
                        }}
                      >
                        {date.year} &middot; {date.dow}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 10.5,
                        color: `var(--kind-${a.kind})`,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                      }}
                    >
                      <KindIcon size={12} />
                      {KIND_LABELS[a.kind as ShowKind]}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--font-geist-sans), sans-serif",
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--ink)",
                          letterSpacing: -0.2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {a.headliner}
                      </div>
                      {a.support && a.support.length > 0 && (
                        <div
                          style={{
                            fontFamily: "var(--font-geist-mono), monospace",
                            fontSize: 10.5,
                            color: "var(--muted)",
                            marginTop: 2,
                          }}
                        >
                          + {a.support.join(", ")}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 11,
                        color: isOnSale ? "var(--accent)" : "var(--muted)",
                        fontWeight: isOnSale ? 500 : 400,
                      }}
                    >
                      {formatOnSaleDate(a.onSaleDate)}
                    </div>
                    <div>
                      <span
                        style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 10,
                          color: "var(--ink)",
                          letterSpacing: ".06em",
                          textTransform: "uppercase",
                          padding: "3px 8px",
                          border: `1px solid var(--kind-${a.kind})`,
                        }}
                      >
                        {ON_SALE_STATUS_LABELS[a.onSaleStatus] ?? a.onSaleStatus}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Your shows */}
        <section>
          <SectionHeader
            label={`Your shows · ${userShows.length}`}
            note="newest first"
          />
          {userShowsQuery.isLoading ? (
            <CardMessage>Loading your history…</CardMessage>
          ) : userShows.length === 0 ? (
            <CardMessage>
              You haven&apos;t logged any shows here yet.
            </CardMessage>
          ) : (
            <div style={{ background: "var(--surface)" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 110px 1fr 1.2fr 90px",
                  columnGap: 16,
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--rule)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 9.5,
                  color: "var(--faint)",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                }}
              >
                <div>Date</div>
                <div>Kind</div>
                <div>Headliner</div>
                <div>Tour</div>
                <div style={{ textAlign: "right" }}>Seat</div>
              </div>
              {userShows.map((s) => {
                const KindIcon = KIND_ICONS[s.kind];
                const support = getSupport(s);
                return (
                  <div
                    key={s.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "110px 110px 1fr 1.2fr 90px",
                      columnGap: 16,
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--rule)",
                      alignItems: "baseline",
                      borderLeft: `2px solid var(--kind-${s.kind})`,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 11,
                        color: "var(--muted)",
                        letterSpacing: ".02em",
                      }}
                    >
                      {formatDateLong(s.date)}
                    </div>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 10.5,
                        color: `var(--kind-${s.kind})`,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                      }}
                    >
                      <KindIcon size={12} />
                      {KIND_LABELS[s.kind]}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--font-geist-sans), sans-serif",
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--ink)",
                          letterSpacing: -0.2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {getHeadliner(s)}
                      </div>
                      {support.length > 0 && (
                        <div
                          style={{
                            fontFamily: "var(--font-geist-mono), monospace",
                            fontSize: 10.5,
                            color: "var(--muted)",
                            marginTop: 2,
                          }}
                        >
                          + {support.join(", ")}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-geist-sans), sans-serif",
                        fontSize: 13,
                        color: "var(--ink)",
                        fontStyle: s.tourName ? "italic" : "normal",
                        letterSpacing: -0.1,
                      }}
                    >
                      {s.tourName ?? "—"}
                    </div>
                    <div
                      style={{
                        textAlign: "right",
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 11,
                        color: "var(--muted)",
                      }}
                    >
                      {s.seat ?? "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Map link if we have coords */}
        {venue.latitude != null && venue.longitude != null && (
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "var(--muted)",
              letterSpacing: ".04em",
            }}
          >
            <Link
              href="/map"
              style={{
                color: "var(--muted)",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              View on map <ArrowUpRight size={11} />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label, note }: { label: string; note?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--ink)",
          letterSpacing: ".1em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {note && (
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--faint)",
            letterSpacing: ".04em",
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10,
          color: "var(--faint)",
          letterSpacing: ".12em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 22,
          fontWeight: 500,
          color: "var(--ink)",
          letterSpacing: -0.6,
          marginTop: 4,
          fontFeatureSettings: '"tnum"',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function CardMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "24px 16px",
        background: "var(--surface)",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
        color: "var(--muted)",
        letterSpacing: ".04em",
      }}
    >
      {children}
    </div>
  );
}

function CenteredMessage({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 300,
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: "0.85rem",
        color: tone === "error" ? "var(--kind-theatre)" : "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}
